import { and, count, desc, eq, gte, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { customerProfiles, messages, vipAlerts } from '@/lib/db/schema';
import { startOfToday } from './profile-builder';
import type { VipAlertData, VipProfileLike, VipRecognitionStore } from './vip-recognition.ts';

/**
 * Drizzle adapter for Gate #10 — the only module that reads or writes
 * `vip_alerts` rows and the staff-facing system messages they raise. Imported
 * by route handlers and the webhook only; nothing in `lib/**.test.ts` may
 * import it, because `@/lib/db` throws at import time without DATABASE_URL.
 * Framework-free tests should import ./vip-recognition.ts (detection + copy +
 * the in-memory-testable orchestrator) instead.
 */

export type VipAlertRow = typeof vipAlerts.$inferSelect;

/** All VIP alerts a tenant can list in one window (the last 7 days). */
export const VIP_ALERTS_WINDOW_DAYS = 7;

/**
 * Keep the Drizzle camelCase shape while exposing the snake_case names the
 * table (and the Gate #10 contract) use, so API consumers can rely on either.
 */
export function serializeVipAlert(alert: VipAlertRow) {
  return {
    ...alert,
    customer_phone: alert.customerPhone,
    customer_name: alert.customerName,
    total_visits: alert.totalVisits,
    total_spend_cents: alert.totalSpendCents,
    last_visit_at: alert.lastVisitAt,
    sent_at: alert.sentAt,
    served_at: alert.servedAt,
  };
}

/**
 * Look up a customer's profile for a phone + tenant. Returns null when no
 * profile exists — VIP detection then falls through to a normal conversation.
 */
export async function findProfileByPhone(
  tenantId: string,
  customerPhone: string
): Promise<VipProfileLike | null> {
  const [profile] = await db
    .select()
    .from(customerProfiles)
    .where(and(eq(customerProfiles.tenantId, tenantId), eq(customerProfiles.customerPhone, customerPhone)))
    .limit(1);
  return profile ?? null;
}

/** Insert a VIP alert row (one per walk-in). */
export async function saveVipAlert(input: {
  tenantId: string;
  alert: VipAlertData;
}): Promise<{ id: string } | null> {
  const [row] = await db
    .insert(vipAlerts)
    .values({
      tenantId: input.tenantId,
      customerPhone: input.alert.customerPhone,
      customerName: input.alert.customerName ?? undefined,
      totalVisits: input.alert.totalVisits,
      totalSpendCents: input.alert.totalSpendCents,
      lastVisitAt: input.alert.lastVisitAt ?? new Date(),
      preferences: input.alert.preferences ?? {},
    })
    .returning({ id: vipAlerts.id });
  return row ?? null;
}

/**
 * Insert a staff-facing system message into the conversation thread. It is
 * never enqueued for dispatch, so the customer never sees it.
 */
export async function saveSystemMessage(input: {
  tenantId: string;
  conversationId: string;
  content: string;
}): Promise<{ id: string } | null> {
  const [row] = await db
    .insert(messages)
    .values({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: 'system',
      content: input.content,
      isAIGenerated: false,
      messageType: 'system',
    })
    .returning({ id: messages.id });
  return row ?? null;
}

/** List a tenant's VIP alerts for the last N days, newest first. */
export async function listVipAlerts(tenantId: string, limit = 100, offset = 0): Promise<VipAlertRow[]> {
  const since = new Date(Date.now() - VIP_ALERTS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(vipAlerts)
    .where(and(eq(vipAlerts.tenantId, tenantId), gte(vipAlerts.sentAt, since)))
    .orderBy(desc(vipAlerts.sentAt))
    .limit(limit)
    .offset(offset);
}

/** List a tenant's VIP alerts raised since local midnight, newest first. */
export async function listVipAlertsToday(tenantId: string, limit = 100): Promise<VipAlertRow[]> {
  const since = startOfToday();
  return db
    .select()
    .from(vipAlerts)
    .where(and(eq(vipAlerts.tenantId, tenantId), gte(vipAlerts.sentAt, since)))
    .orderBy(desc(vipAlerts.sentAt))
    .limit(limit);
}

/** Count a tenant's VIP alerts in the last N days (for pagination). */
export async function countVipAlerts(tenantId: string): Promise<number> {
  const since = new Date(Date.now() - VIP_ALERTS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ value: count() })
    .from(vipAlerts)
    .where(and(eq(vipAlerts.tenantId, tenantId), gte(vipAlerts.sentAt, since)));
  return Number(row?.value ?? 0);
}

/** Platform-wide count of today's VIP alerts, used only after the Super Admin gate. */
export async function countVipAlertsToday(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(vipAlerts)
    .where(gte(vipAlerts.sentAt, startOfToday()));
  return Number(row?.value ?? 0);
}

/** Mark a VIP alert as served. Idempotent and tenant-scoped: only a not-yet-served row for this tenant flips. */
export async function markVipAlertServed(tenantId: string, alertId: string): Promise<boolean> {
  const rows = await db
    .update(vipAlerts)
    .set({ servedAt: new Date() })
    .where(and(eq(vipAlerts.tenantId, tenantId), eq(vipAlerts.id, alertId), isNull(vipAlerts.servedAt)))
    .returning({ id: vipAlerts.id });
  return rows.length > 0;
}

/** Attach a staff note to a VIP alert, tenant-scoped. */
export async function addVipAlertNote(tenantId: string, alertId: string, note: string): Promise<boolean> {
  const rows = await db
    .update(vipAlerts)
    .set({ note })
    .where(and(eq(vipAlerts.tenantId, tenantId), eq(vipAlerts.id, alertId)))
    .returning({ id: vipAlerts.id });
  return rows.length > 0;
}

/** The webhook's Drizzle adapter, satisfying the framework-free store. */
export const drizzleVipRecognitionStore: VipRecognitionStore = {
  findProfileByPhone,
  saveVipAlert,
  saveSystemMessage,
};
