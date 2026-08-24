import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { reservations, revenueEvents } from '@/lib/db/schema';
import type { MissedEnquiryLike, PendingCancellationLike, PendingNoShowLike, PriorityStore } from './priorities.ts';

/**
 * Drizzle adapter for the Gate #5 priority analytics in ./priorities.ts —
 * the only module that reads these rows for priorities. Imported by route
 * handlers only; nothing in `lib/**.test.ts` may import it, because
 * `@/lib/db` throws at import time without DATABASE_URL (same rule as the
 * Gate #2-#4 stores).
 *
 * The three scans are the tenant-scoped reads this gate adds:
 *
 *   findMissedEnquiries — `revenue_events` rows of type 'missed_enquiry'
 *   in the last 7 days with a positive estimated value.
 *
 *   findPendingCancellations — reservations cancelled in the last 7 days
 *   whose Gate #3 follow-up flag is still false, i.e. the rebook offer
 *   has not gone out and the table is still winnable.
 *
 *   findPendingNoShows — reservations flagged as no-shows in the last 7
 *   days whose Gate #4 follow-up flag is still false, for the same
 *   reason.
 *
 * The fourth opportunity type — slow days — is NOT a new scan. It is the
 * Gate #2 scan, and the callers already run it: the summary route and the
 * morning brief call `detectSlowDaysForTenant(drizzleSlowDayStore, ...)`
 * once per tenant and hand the report to `buildTenantPriorities`, so a
 * tenant's reservation history is read once, not twice, per request.
 *
 * Cross-tenant, for the super-admin "Total Priority Value" KPI, the story
 * is the same: the admin page already runs `fetchSlowDayAggregatesByTenant`
 * (./slow-days-store.ts) — one query, the whole platform — for its
 * "Slow Days Detected" KPI, and feeds the same result into
 * `totalTopPriorityValueCents` (./priorities.ts) for this one. One shared
 * fetch, two KPIs, zero extra queries.
 */

export const drizzlePriorityStore: PriorityStore = {
  /**
   * Valued missed-enquiry events inside the window. `estimated_value_cents
   * >= 1` keeps the scan to rows that are worth a phone call — a
   * zero-value missed enquiry has nothing to recover.
   */
  async findMissedEnquiries({ tenantId, start, end }): Promise<MissedEnquiryLike[]> {
    return db
      .select({
        estimatedValueCents: revenueEvents.estimatedValueCents,
        occurredAt: revenueEvents.occurredAt,
      })
      .from(revenueEvents)
      .where(
        and(
          eq(revenueEvents.tenantId, tenantId),
          eq(revenueEvents.eventType, 'missed_enquiry'),
          gte(revenueEvents.estimatedValueCents, 1),
          gte(revenueEvents.occurredAt, start),
          lte(revenueEvents.occurredAt, end)
        )
      );
  },

  /**
   * Cancellations inside the window that have not been followed up yet.
   * `cancelled_at IS NOT NULL` is in the WHERE clause because the column
   * is nullable (pre-Gate #3 rows) and the window is measured from it.
   */
  async findPendingCancellations({ tenantId, start, end }): Promise<PendingCancellationLike[]> {
    const rows = await db
      .select({
        partySize: reservations.partySize,
        cancelledAt: reservations.cancelledAt,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.tenantId, tenantId),
          eq(reservations.status, 'cancelled'),
          isNotNull(reservations.cancelledAt),
          eq(reservations.cancellationFollowupSent, false),
          gte(reservations.cancelledAt, start),
          lte(reservations.cancelledAt, end)
        )
      );

    // `cancelled_at IS NOT NULL` is in the WHERE clause, but the column is
    // nullable in the schema, so narrow here rather than casting.
    return rows.flatMap((row) => {
      if (!row.cancelledAt) return [];
      return [{ partySize: row.partySize, cancelledAt: row.cancelledAt }];
    });
  },

  /**
   * Detected no-shows inside the window that have not been followed up
   * yet. The window is measured from `no_show_detected_at` (the Gate #4
   * dedup timestamp), not the booking date: a no-show is an action item
   * from the moment it was detected.
   */
  async findPendingNoShows({ tenantId, start, end }): Promise<PendingNoShowLike[]> {
    const rows = await db
      .select({
        partySize: reservations.partySize,
        reservationDate: reservations.date,
        detectedAt: reservations.noShowDetectedAt,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.tenantId, tenantId),
          eq(reservations.noShowDetected, true),
          isNotNull(reservations.noShowDetectedAt),
          eq(reservations.noShowFollowupSent, false),
          gte(reservations.noShowDetectedAt, start),
          lte(reservations.noShowDetectedAt, end)
        )
      );

    return rows.flatMap((row) => {
      if (!row.detectedAt) return [];
      return [{ partySize: row.partySize, reservationDate: row.reservationDate, detectedAt: row.detectedAt }];
    });
  },
};
