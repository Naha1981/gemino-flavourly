import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  contacts,
  customerProfiles,
  reactivationCampaigns,
  tenants,
  waAccounts,
} from '@/lib/db/schema';
import { operatorClient } from '@/lib/operator-client';
import {
  REACTIVATION_REPLY_WINDOW_DAYS,
  isReactivationReply,
  type ReactivationSegment,
} from './reactivation.ts';

/**
 * Drizzle adapter for Gate #9 — the only module that reads or writes
 * `reactivation_campaigns` rows. Imported by the cron route, the webhook
 * and the dashboard APIs; nothing in `lib/**.test.ts` may import it,
 * because `@/lib/db` throws at import time without DATABASE_URL.
 *
 * Tenant scoping: every query takes an explicit tenantId and filters on it
 * — identical phone numbers in two restaurants are independent customers
 * with independent campaign histories.
 */

export type ReactivationCampaignRow = typeof reactivationCampaigns.$inferSelect;

/** A dormant/at-risk customer the cron may consider messaging. */
export interface ReactivationCandidate {
  profileId: string;
  tenantId: string;
  customerPhone: string;
  customerName: string | null;
  /** Stored Gate #8 segment, re-derived by resolveReactivationTarget. */
  segment: string;
  lastVisitAt: Date | null;
  preferences: unknown;
  /** True when the matching contact row is opted out (POPIA STOP). */
  optedOut: boolean;
  tenantName: string;
  tenantAiEnabled: boolean;
  tenantManualMode: boolean;
}

export function serializeReactivationCampaign(campaign: ReactivationCampaignRow) {
  return {
    id: campaign.id,
    tenantId: campaign.tenantId,
    customerPhone: campaign.customerPhone,
    segment: campaign.segment,
    messageText: campaign.messageText,
    sentAt: campaign.sentAt,
    responded: campaign.responded,
    createdAt: campaign.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Campaign mutations (the gate's specified store contract)
// ---------------------------------------------------------------------------

/** Insert a campaign row with sent_at NULL — dispatch happens after. */
export async function createPendingCampaign(
  tenantId: string,
  customerPhone: string,
  segment: ReactivationSegment,
  messageText: string
): Promise<ReactivationCampaignRow> {
  const [created] = await db
    .insert(reactivationCampaigns)
    .values({
      tenantId,
      customerPhone,
      segment,
      messageText,
    })
    .returning();
  return created;
}

/**
 * Mark a campaign dispatched. Conditional on sent_at IS NULL so a retried
 * run (or two racing runs) cannot move the timestamp twice — the send
 * happened once, so sent_at is stamped once. Returns true when a row changed.
 */
export async function markSent(campaignId: string, sentAt: Date = new Date()): Promise<boolean> {
  const changed = await db
    .update(reactivationCampaigns)
    .set({ sentAt })
    .where(and(eq(reactivationCampaigns.id, campaignId), isNull(reactivationCampaigns.sentAt)))
    .returning({ id: reactivationCampaigns.id });
  return changed.length > 0;
}

/**
 * Mark a campaign responded. Conditional on responded = false so the
 * transition (and any listener on it) happens exactly once per campaign.
 */
export async function markResponded(campaignId: string): Promise<boolean> {
  const changed = await db
    .update(reactivationCampaigns)
    .set({ responded: true })
    .where(and(eq(reactivationCampaigns.id, campaignId), eq(reactivationCampaigns.responded, false)))
    .returning({ id: reactivationCampaigns.id });
  return changed.length > 0;
}

/** Campaigns created but never dispatched — the cron's reconciliation scan. */
export async function getPendingCampaigns(tenantId: string): Promise<ReactivationCampaignRow[]> {
  return db
    .select()
    .from(reactivationCampaigns)
    .where(and(eq(reactivationCampaigns.tenantId, tenantId), isNull(reactivationCampaigns.sentAt)))
    .orderBy(reactivationCampaigns.createdAt);
}

/** Full campaign history for one customer, newest first. */
export async function getCampaignHistory(
  tenantId: string,
  customerPhone: string
): Promise<ReactivationCampaignRow[]> {
  return db
    .select()
    .from(reactivationCampaigns)
    .where(
      and(
        eq(reactivationCampaigns.tenantId, tenantId),
        eq(reactivationCampaigns.customerPhone, customerPhone)
      )
    )
    .orderBy(desc(reactivationCampaigns.createdAt));
}

// ---------------------------------------------------------------------------
// Candidate + cooldown reads used by the cron
// ---------------------------------------------------------------------------

/**
 * Dormant/at-risk customers for one tenant.
 *
 * POPIA and tenant-flag exclusions happen in SQL, not in the runner, so an
 * opted-out contact (contacts.blocklisted, set by the STOP path) or a tenant
 * with AI disabled / in manual mode can never even become a candidate —
 * the runner additionally re-checks the flags as defense in depth.
 *
 * Eligibility matches the gate: `segment IN ('dormant','at_risk') OR
 * last_visit_at < NOW() - 180 days` (NULL last_visit rows qualify only via
 * the stored dormant label, which Gate #8's segmentation assigns to them).
 */
export async function fetchReactivationCandidates(
  tenantId: string,
  dormantCutoff: Date
): Promise<ReactivationCandidate[]> {
  const rows = await db
    .select({
      profileId: customerProfiles.id,
      tenantId: customerProfiles.tenantId,
      customerPhone: customerProfiles.customerPhone,
      customerName: customerProfiles.customerName,
      segment: customerProfiles.segment,
      lastVisitAt: customerProfiles.lastVisitAt,
      preferences: customerProfiles.preferences,
      blocklisted: contacts.blocklisted,
      tenantName: tenants.name,
      aiEnabled: tenants.aiEnabled,
      manualMode: tenants.manualMode,
    })
    .from(customerProfiles)
    .innerJoin(tenants, eq(tenants.id, customerProfiles.tenantId))
    .leftJoin(
      contacts,
      and(
        eq(contacts.tenantId, customerProfiles.tenantId),
        eq(contacts.phone, customerProfiles.customerPhone)
      )
    )
    .where(
      and(
        eq(customerProfiles.tenantId, tenantId),
        eq(tenants.aiEnabled, true),
        eq(tenants.manualMode, false),
        or(isNull(contacts.id), eq(contacts.blocklisted, false)),
        or(
          inArray(customerProfiles.segment, ['dormant', 'at_risk']),
          lt(customerProfiles.lastVisitAt, dormantCutoff)
        )
      )
    )
    .limit(500);

  return rows.map((row) => ({
    profileId: row.profileId,
    tenantId: row.tenantId,
    customerPhone: row.customerPhone,
    customerName: row.customerName,
    segment: row.segment,
    lastVisitAt: row.lastVisitAt,
    preferences: row.preferences,
    optedOut: false,
    tenantName: row.tenantName,
    tenantAiEnabled: row.aiEnabled,
    tenantManualMode: row.manualMode,
  }));
}

/**
 * Phones that received (or were at least assigned) a campaign since
 * `since`. Measured from COALESCE(sent_at, created_at): a campaign created
 * moments ago but not yet dispatched still counts, so a crashed or racing
 * run can never double-message the same customer within the 90-day window.
 */
export async function fetchRecentCampaignRecipients(
  tenantId: string,
  since: Date
): Promise<Set<string>> {
  const rows = await db
    .select({ phone: reactivationCampaigns.customerPhone })
    .from(reactivationCampaigns)
    .where(
      and(
        eq(reactivationCampaigns.tenantId, tenantId),
        gte(
          sql`coalesce(${reactivationCampaigns.sentAt}, ${reactivationCampaigns.createdAt})`,
          since
        )
      )
    );
  return new Set(rows.map((row) => row.phone));
}

/** The tenant's connected WhatsApp account, or null when none is linked. */
export async function findWhatsAppAccount(tenantId: string): Promise<string | null> {
  const [account] = await db
    .select({ id: waAccounts.id })
    .from(waAccounts)
    .where(and(eq(waAccounts.tenantId, tenantId), eq(waAccounts.isConnected, true)))
    .limit(1);
  return account?.id ?? null;
}

/**
 * Dispatch one campaign message through the operator. tenantId is verified
 * operator-side against the account's owner, so a bug here cannot send
 * through another restaurant's number.
 */
export async function dispatchWhatsApp(input: {
  tenantId: string;
  waAccountId: string;
  to: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await operatorClient.sendMessage(input.tenantId, input.waAccountId, input.to, input.text);
  if (result.success) return { ok: true };
  return { ok: false, error: result.error ?? 'Operator send failed' };
}

// ---------------------------------------------------------------------------
// Dashboard reads
// ---------------------------------------------------------------------------

export async function listCampaigns(
  tenantId: string,
  limit = 50,
  offset = 0
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
    .select({ n: sql<number>`count(*)::int` })
    .from(reactivationCampaigns)
    .where(eq(reactivationCampaigns.tenantId, tenantId));
  return row?.n ?? 0;
}

export interface ReactivationCampaignStats {
  total: number;
  pending: number;
  sent: number;
  responded: number;
  /** responded / sent, 0 when nothing has been sent yet. */
  responseRate: number;
}

export async function campaignStats(tenantId: string): Promise<ReactivationCampaignStats> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      sent: sql<number>`count(${reactivationCampaigns.sentAt})::int`,
      responded: sql<number>`count(*) filter (where ${reactivationCampaigns.responded})::int`,
    })
    .from(reactivationCampaigns)
    .where(eq(reactivationCampaigns.tenantId, tenantId));

  const total = row?.total ?? 0;
  const sent = row?.sent ?? 0;
  const responded = row?.responded ?? 0;
  return {
    total,
    pending: total - sent,
    sent,
    responded,
    responseRate: sent === 0 ? 0 : Math.round((responded / sent) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Response handling (webhook path)
// ---------------------------------------------------------------------------

/**
 * Record a customer's reply against their most recent sent-but-unanswered
 * campaign. Called from the inbound WhatsApp webhook:
 *
 *   - the reply must carry booking intent (isReactivationReply — "book",
 *     "reserve", "table", …), so a "no thanks" or a STOP does not burn the
 *     campaign's response flag;
 *   - only a campaign actually dispatched (sent_at NOT NULL) within the
 *     reply window counts as the one being answered;
 *   - the webhook's normal flow continues afterwards, so a reply like
 *     "I'd like to book Saturday for 4" drops straight into the AI booking
 *     flow — responding here is bookkeeping, not a takeover.
 *
 * Tenant-scoped by construction: the webhook derives tenantId from the
 * WhatsApp account, and the lookup below always pairs it with the phone.
 */
export async function markRespondedForReply(
  tenantId: string,
  customerPhone: string,
  text: string,
  now: Date = new Date()
): Promise<ReactivationCampaignRow | null> {
  if (!isReactivationReply(text)) return null;

  const windowStart = new Date(now.getTime() - REACTIVATION_REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [campaign] = await db
    .select()
    .from(reactivationCampaigns)
    .where(
      and(
        eq(reactivationCampaigns.tenantId, tenantId),
        eq(reactivationCampaigns.customerPhone, customerPhone),
        gte(reactivationCampaigns.sentAt, windowStart),
        eq(reactivationCampaigns.responded, false)
      )
    )
    .orderBy(desc(reactivationCampaigns.sentAt))
    .limit(1);

  if (!campaign) return null;
  await markResponded(campaign.id);
  return campaign;
}
