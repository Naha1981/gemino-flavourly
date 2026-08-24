import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  contacts,
  customerProfiles,
  jobs,
  reactivationCampaigns,
  tenants,
  waAccounts,
} from '@/lib/db/schema';
import { isWithinResponseWindow, type ReactivationSegment } from './reactivation.ts';
import type {
  ReactivationCampaignStore,
  ReactivationCandidate,
  ReactivationTenant,
} from './reactivation-cron.ts';

/**
 * Drizzle adapter for Gate #9 — the only module that reads or writes
 * `reactivation_campaigns` rows. Imported by route handlers and dashboard
 * pages only; nothing in `lib/**.test.ts` may import it, because `@/lib/db`
 * throws at import time without DATABASE_URL. Framework-free tests should
 * import ./reactivation.ts (copy + eligibility) or ./reactivation-cron.ts
 * (the runner, with an in-memory store) instead.
 */

export type ReactivationCampaignRow = typeof reactivationCampaigns.$inferSelect;

/** Campaign row joined with the customer's display name, for list views. */
export type ReactivationCampaignListRow = ReactivationCampaignRow & {
  customerName: string | null;
};

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
): Promise<ReactivationCampaignListRow[]> {
  const rows = await db
    .select({
      campaign: reactivationCampaigns,
      customerName: customerProfiles.customerName,
    })
    .from(reactivationCampaigns)
    .leftJoin(
      customerProfiles,
      and(
        eq(customerProfiles.tenantId, reactivationCampaigns.tenantId),
        eq(customerProfiles.customerPhone, reactivationCampaigns.customerPhone)
      )
    )
    .where(eq(reactivationCampaigns.tenantId, tenantId))
    .orderBy(desc(reactivationCampaigns.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({ ...row.campaign, customerName: row.customerName }));
}

export async function countCampaigns(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(reactivationCampaigns)
    .where(eq(reactivationCampaigns.tenantId, tenantId));
  return Number(row?.value ?? 0);
}

/**
 * One profile plus its POPIA opt-out flag, for the manual-send API. Unlike
 * fetchCampaignCandidates this does NOT prefilter on the stored segment: the
 * API decides eligibility with a fresh resolveReactivationTarget call, so a
 * staff member can send to a customer the segmentation cron has not yet
 * re-classified. The blocklisted flag is still returned — and enforced by the
 * caller — because opting out must block even a manual send.
 */
export interface ReactivationTargetProfile {
  profileId: string;
  customerPhone: string;
  customerName: string | null;
  totalVisits: number;
  lastVisitAt: Date | null;
  segment: string | null;
  preferences: unknown;
  blocklisted: boolean;
}

export async function findReactivationTargetProfile(
  tenantId: string,
  customerPhone: string
): Promise<ReactivationTargetProfile | null> {
  const [profile] = await db
    .select()
    .from(customerProfiles)
    .where(and(eq(customerProfiles.tenantId, tenantId), eq(customerProfiles.customerPhone, customerPhone)))
    .limit(1);
  if (!profile) return null;

  const [contact] = await db
    .select({ blocklisted: contacts.blocklisted })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.phone, customerPhone)))
    .limit(1);

  return {
    profileId: profile.id,
    customerPhone: profile.customerPhone,
    customerName: profile.customerName,
    totalVisits: profile.totalVisits,
    lastVisitAt: profile.lastVisitAt,
    segment: profile.segment,
    preferences: profile.preferences,
    blocklisted: Boolean(contact?.blocklisted),
  };
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

// -----------------------------------------------------------------------------
// Cron adapter — satisfies ./reactivation-cron.ts's store interface
// -----------------------------------------------------------------------------

/** Every tenant with its automation flags; the runner enforces them. */
export async function findReactivationTenants(): Promise<ReactivationTenant[]> {
  const rows = await db
    .select({ id: tenants.id, name: tenants.name, aiEnabled: tenants.aiEnabled, manualMode: tenants.manualMode })
    .from(tenants);
  return rows;
}

/**
 * Profiles stored as dormant / at_risk for one tenant, with the contact's
 * POPIA opt-out flag attached. Opted-out contacts are excluded in SQL so the
 * rows never even reach the loop (the runner re-checks the flag for other
 * store implementations). A LEFT JOIN keeps profiles whose contact row is
 * gone — there is no opt-out record to respect for those.
 */
export async function fetchCampaignCandidates(tenantId: string): Promise<ReactivationCandidate[]> {
  const rows = await db
    .select({
      profileId: customerProfiles.id,
      tenantId: customerProfiles.tenantId,
      customerPhone: customerProfiles.customerPhone,
      customerName: customerProfiles.customerName,
      totalVisits: customerProfiles.totalVisits,
      lastVisitAt: customerProfiles.lastVisitAt,
      storedSegment: customerProfiles.segment,
      preferences: customerProfiles.preferences,
      blocklisted: contacts.blocklisted,
    })
    .from(customerProfiles)
    .leftJoin(
      contacts,
      and(eq(contacts.tenantId, customerProfiles.tenantId), eq(contacts.phone, customerProfiles.customerPhone))
    )
    .where(
      and(
        eq(customerProfiles.tenantId, tenantId),
        inArray(customerProfiles.segment, ['dormant', 'at_risk']),
        // POPIA: opted-out contacts are filtered out before loading.
        sql`COALESCE(${contacts.blocklisted}, false) = false`
      )
    );

  return rows.map((row) => ({
    ...row,
    // SQL already excluded opted-out contacts; normalize the LEFT JOIN's
    // NULL (no contact row) to the runner's boolean shape.
    blocklisted: Boolean(row.blocklisted),
  }));
}

/**
 * Hand the campaign message to the outbox rather than calling the operator
 * directly: the outbox owns retries, stuck-job recovery and delivery state.
 * This is the same send path the webhook and cancellation follow-up use.
 */
export async function queueCampaignMessage(input: {
  tenantId: string;
  waAccountId: string;
  to: string;
  text: string;
}): Promise<void> {
  await db.insert(jobs).values({
    tenantId: input.tenantId,
    type: 'send_whatsapp',
    payload: { waAccountId: input.waAccountId, to: input.to, text: input.text },
    status: 'pending',
    nextRunAt: new Date(),
  });
}

/** The tenant's connected WhatsApp account, or null when none is linked. */
export async function resolveReactivationSender(tenantId: string): Promise<{ waAccountId: string } | null> {
  const [account] = await db
    .select({ id: waAccounts.id })
    .from(waAccounts)
    .where(and(eq(waAccounts.tenantId, tenantId), eq(waAccounts.isConnected, true)))
    .limit(1);
  return account ? { waAccountId: account.id } : null;
}

/** The cron store wired from the functions above plus the campaign CRUD. */
export const drizzleReactivationCronStore: ReactivationCampaignStore = {
  findTenants: findReactivationTenants,
  fetchCampaignCandidates,
  findLatestCampaign,
  createPendingCampaign,
  markSent,
  queueCampaignMessage,
  resolveSender: resolveReactivationSender,
};
