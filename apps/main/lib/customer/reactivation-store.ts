import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { reactivationCampaigns } from '@/lib/db/schema';
import { isWithinResponseWindow, type ReactivationSegment } from './reactivation.ts';

/**
 * Drizzle adapter for Gate #9 — the only module that reads or writes
 * `reactivation_campaigns` rows. Imported by route handlers and dashboard
 * pages only; nothing in `lib/**.test.ts` may import it, because `@/lib/db`
 * throws at import time without DATABASE_URL. Framework-free tests should
 * import ./reactivation.ts (copy + eligibility) or ./reactivation-cron.ts
 * (the runner, with an in-memory store) instead.
 */

export type ReactivationCampaignRow = typeof reactivationCampaigns.$inferSelect;

/**
 * Keep the Drizzle camelCase shape while exposing the snake_case names the
 * table (and the Gate #9 contract) use, so API consumers can rely on either.
 */
export function serializeReactivationCampaign(campaign: ReactivationCampaignRow) {
  return {
    ...campaign,
    segment: campaign.segment as ReactivationSegment,
    sent_at: campaign.sentAt,
    created_at: campaign.createdAt,
  };
}

/**
 * Insert a campaign row with sent_at NULL. The row exists before the message
 * is dispatched so a crash between "decided to message" and "handed to the
 * outbox" leaves a visible pending row the next cron run can resume instead
 * of silently disappearing.
 */
export async function createPendingCampaign(
  tenantId: string,
  customerPhone: string,
  segment: ReactivationSegment,
  messageText: string
): Promise<ReactivationCampaignRow> {
  const [row] = await db
    .insert(reactivationCampaigns)
    .values({ tenantId, customerPhone, segment, messageText })
    .returning();
  return row;
}

/**
 * Stamp the moment the message was handed off. `sentAt` is passed in (not
 * defaulted to NOW()) so the cron runner can pass its single injected `now`
 * and tests can pin time.
 */
export async function markSent(campaignId: string, sentAt: Date = new Date()): Promise<boolean> {
  const rows = await db
    .update(reactivationCampaigns)
    .set({ sentAt })
    .where(and(eq(reactivationCampaigns.id, campaignId), isNull(reactivationCampaigns.sentAt)))
    .returning({ id: reactivationCampaigns.id });
  return rows.length > 0;
}

export async function markResponded(campaignId: string): Promise<boolean> {
  const rows = await db
    .update(reactivationCampaigns)
    .set({ responded: true })
    .where(and(eq(reactivationCampaigns.id, campaignId), eq(reactivationCampaigns.responded, false)))
    .returning({ id: reactivationCampaigns.id });
  return rows.length > 0;
}

/** Campaigns created but never handed to the outbox, for the current tenant. */
export async function getPendingCampaigns(tenantId: string): Promise<ReactivationCampaignRow[]> {
  return db
    .select()
    .from(reactivationCampaigns)
    .where(and(eq(reactivationCampaigns.tenantId, tenantId), isNull(reactivationCampaigns.sentAt)))
    .orderBy(reactivationCampaigns.createdAt);
}

/** Every campaign ever sent to one customer, newest first. */
export async function getCampaignHistory(
  tenantId: string,
  customerPhone: string
): Promise<ReactivationCampaignRow[]> {
  return db
    .select()
    .from(reactivationCampaigns)
    .where(and(eq(reactivationCampaigns.tenantId, tenantId), eq(reactivationCampaigns.customerPhone, customerPhone)))
    .orderBy(desc(reactivationCampaigns.createdAt));
}

/**
 * The customer's most recent campaign of any state. The cron uses it for the
 * 90-day cooldown check and to resume an unsent pending row; only sent
 * campaigns gate the cooldown (a pending row is resumed, never duplicated).
 */
export async function findLatestCampaign(
  tenantId: string,
  customerPhone: string
): Promise<ReactivationCampaignRow | null> {
  const [row] = await db
    .select()
    .from(reactivationCampaigns)
    .where(and(eq(reactivationCampaigns.tenantId, tenantId), eq(reactivationCampaigns.customerPhone, customerPhone)))
    .orderBy(desc(reactivationCampaigns.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listCampaigns(
  tenantId: string,
  limit: number,
  offset: number
): Promise<ReactivationCampaignRow[]> {
  return db
    .select()
    .from(reactivationCampaigns)
    .where(eq(reactivationCampaigns.tenantId, tenantId))
    .orderBy(desc(reactivationCampaigns.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function countCampaigns(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(reactivationCampaigns)
    .where(eq(reactivationCampaigns.tenantId, tenantId));
  return Number(row?.value ?? 0);
}

export interface ReactivationCampaignStats {
  total: number;
  /** Created but not yet handed to the outbox. */
  pending: number;
  /** Handed to the outbox (sent_at set), including responded ones. */
  sent: number;
  responded: number;
  /** responded / sent as a 0..1 ratio; 0 when nothing has been sent. */
  responseRate: number;
}

export async function campaignStats(tenantId: string): Promise<ReactivationCampaignStats> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) FILTER (WHERE ${reactivationCampaigns.sentAt} IS NULL)::int`,
      sent: sql<number>`count(*) FILTER (WHERE ${reactivationCampaigns.sentAt} IS NOT NULL)::int`,
      responded: sql<number>`count(*) FILTER (WHERE ${reactivationCampaigns.responded} AND ${reactivationCampaigns.sentAt} IS NOT NULL)::int`,
    })
    .from(reactivationCampaigns)
    .where(eq(reactivationCampaigns.tenantId, tenantId));

  const total = Number(row?.total ?? 0);
  const pending = Number(row?.pending ?? 0);
  const sent = Number(row?.sent ?? 0);
  const responded = Number(row?.responded ?? 0);
  return {
    total,
    pending,
    sent,
    responded,
    responseRate: sent > 0 ? responded / sent : 0,
  };
}

/**
 * Webhook hook: if this customer's latest DISPATCHED campaign is still
 * unresponded and was sent within the response window, mark it responded and
 * return it. Returns null when there is nothing to attribute.
 *
 * Only the latest campaign can be flipped: an old campaign the customer
 * never answered stays unresponded, which is exactly the signal the
 * response-rate metric wants.
 */
export async function markLatestCampaignResponded(
  tenantId: string,
  customerPhone: string,
  now: Date = new Date()
): Promise<ReactivationCampaignRow | null> {
  const [latest] = await db
    .select()
    .from(reactivationCampaigns)
    .where(
      and(
        eq(reactivationCampaigns.tenantId, tenantId),
        eq(reactivationCampaigns.customerPhone, customerPhone),
        isNotNull(reactivationCampaigns.sentAt),
        eq(reactivationCampaigns.responded, false)
      )
    )
    .orderBy(desc(reactivationCampaigns.sentAt))
    .limit(1);

  if (!latest?.sentAt) return null;
  if (!isWithinResponseWindow(latest.sentAt, now)) return null;

  const changed = await markResponded(latest.id);
  return changed ? latest : null;
}

/** Object form for callers that prefer an injectable store-shaped adapter. */
export const drizzleReactivationCampaignStore = {
  createPendingCampaign,
  markSent,
  markResponded,
  getPendingCampaigns,
  getCampaignHistory,
  findLatestCampaign,
  listCampaigns,
  countCampaigns,
  campaignStats,
  markLatestCampaignResponded,
};
