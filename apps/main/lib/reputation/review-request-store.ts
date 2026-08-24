import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  contacts,
  conversations,
  googlePlacesConfig,
  jobs,
  reservations,
  tenants,
  waAccounts,
} from '@/lib/db/schema';
import { buildGoogleReviewLink, isEligibleForReviewRequest, type ReviewRequestReservation } from './review-request.ts';

/**
 * Gate #13 — Drizzle adapter for post-visit review requests. Like the
 * reactivation store, the cron-facing queries pre-filter POPIA opt-outs in
 * SQL and the runner re-checks — defense in depth against a wrong join.
 */

export type ReservationRow = typeof reservations.$inferSelect;

/** A sent review request, joined with customer name for the dashboard list. */
export interface ReviewRequestListRow {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  date: Date;
  sentAt: Date | null;
}

/**
 * Eligible reservations for one tenant: confirmed/completed, not yet asked,
 * inside the 2h..26h window, with a reachable phone, NOT opted out.
 *
 * The SQL narrows the candidate set for performance; the definitive
 * eligibility predicate is isEligibleForReviewRequest() in the runner —
 * the same defense-in-depth pattern as the no-show and cancellation crons.
 */
export async function getEligibleReservations(tenantId: string, now: Date): Promise<ReviewRequestReservation[]> {
  const minDate = new Date(now.getTime() - 26 * 60 * 60 * 1000);
  const maxDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: reservations.id,
      tenantId: reservations.tenantId,
      customerName: reservations.customerName,
      customerPhone: reservations.customerPhone,
      date: reservations.date,
      status: reservations.status,
      reviewRequestSent: reservations.reviewRequestSent,
      conversationId: reservations.conversationId,
      blocklisted: contacts.blocklisted,
    })
    .from(reservations)
    .leftJoin(
      contacts,
      and(eq(contacts.tenantId, reservations.tenantId), eq(contacts.phone, reservations.customerPhone))
    )
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        eq(reservations.reviewRequestSent, false),
        sql`${reservations.status} IN ('confirmed', 'completed')`,
        gte(reservations.date, minDate),
        sql`${reservations.date} <= ${maxDate}`,
        sql`${reservations.customerPhone} IS NOT NULL`,
        // POPIA: opted-out contacts are filtered out before the rows load.
        sql`COALESCE(${contacts.blocklisted}, false) = false`
      )
    )
    .orderBy(reservations.date)
    .limit(200);

  return rows.map((row) => ({
    ...row,
    blocklisted: Boolean(row.blocklisted),
  }));
}

/** Stamp the ask so the hourly cron never asks twice for one booking. */
export async function markRequestSent(reservationId: string, tenantId: string, at: Date): Promise<boolean> {
  const rows = await db
    .update(reservations)
    .set({ reviewRequestSent: true, reviewRequestSentAt: at })
    .where(
      and(eq(reservations.id, reservationId), eq(reservations.tenantId, tenantId), eq(reservations.reviewRequestSent, false))
    )
    .returning({ id: reservations.id });
  return rows.length > 0;
}

/** Is the thread for this booking in manual takeover right now? */
export async function isManualTakeover(conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ manualTakeover: conversations.manualTakeover })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return Boolean(row?.manualTakeover);
}

/** The tenant's configured Google place id (raw), or null when unconfigured. */
export async function getPlaceId(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ placeId: googlePlacesConfig.placeId })
    .from(googlePlacesConfig)
    .where(eq(googlePlacesConfig.tenantId, tenantId))
    .limit(1);
  return row?.placeId ?? null;
}

/**
 * The Google review link for this tenant, built from its configured place.
 * Null when the tenant has not configured Google Places — in that case the
 * review request cannot link anywhere, so the cron skips the tenant rather
 * than sending a dead-end message.
 */
export async function getGoogleReviewLink(tenantId: string): Promise<string | null> {
  const placeId = await getPlaceId(tenantId);
  if (!placeId) return null;
  return buildGoogleReviewLink(placeId);
}

/** The tenant's connected WhatsApp account, or null when none is linked. */
export async function resolveReviewRequestSender(tenantId: string): Promise<{ waAccountId: string } | null> {
  const [account] = await db
    .select({ id: waAccounts.id })
    .from(waAccounts)
    .where(and(eq(waAccounts.tenantId, tenantId), eq(waAccounts.isConnected, true)))
    .limit(1);
  return account ? { waAccountId: account.id } : null;
}

/** Hand the request to the outbox (jobs table) — the operator owns delivery. */
export async function queueReviewRequestMessage(input: {
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

/** Every tenant with its automation flags; the runner enforces them. */
export async function findReviewRequestTenants(): Promise<
  Array<{ id: string; name: string | null; aiEnabled: boolean; manualMode: boolean }>
> {
  return db.select({ id: tenants.id, name: tenants.name, aiEnabled: tenants.aiEnabled, manualMode: tenants.manualMode }).from(tenants);
}

/** Sent review requests from the last N days (dashboard list), newest first. */
export async function listRecentRequests(tenantId: string, days = 30): Promise<ReviewRequestListRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select({
      id: reservations.id,
      customerName: reservations.customerName,
      customerPhone: reservations.customerPhone,
      date: reservations.date,
      sentAt: reservations.reviewRequestSentAt,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        eq(reservations.reviewRequestSent, true),
        gte(reservations.reviewRequestSentAt, since)
      )
    )
    .orderBy(desc(reservations.reviewRequestSentAt))
    .limit(200);
}

export interface ReviewRequestStats {
  sentTotal: number;
  sentLast30Days: number;
}

export async function reviewRequestStats(tenantId: string): Promise<ReviewRequestStats> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      last30: sql<number>`count(*) FILTER (WHERE ${reservations.reviewRequestSentAt} >= ${since})::int`,
    })
    .from(reservations)
    .where(and(eq(reservations.tenantId, tenantId), eq(reservations.reviewRequestSent, true)));
  return { sentTotal: Number(row?.total ?? 0), sentLast30Days: Number(row?.last30 ?? 0) };
}

export { isEligibleForReviewRequest };
