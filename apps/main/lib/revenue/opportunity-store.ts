import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { reservations, revenueEvents } from '@/lib/db/schema';
import type {
  CancellationLike,
  MissedEnquiryLike,
  NoShowLike,
  OpportunityInputs,
  OpportunityStore,
} from './opportunity.ts';

/**
 * Drizzle adapter for the Gate #6 opportunity analytics in
 * ./opportunity.ts — the module that reads the rows this gate adds.
 * Imported by route handlers only; nothing in `lib/**.test.ts` may
 * import it, because `@/lib/db` throws at import time without
 * DATABASE_URL (same rule as the Gate #2-#5 stores).
 *
 * The three tenant-scoped scans this gate adds:
 *
 *   findMissedEnquiries — `revenue_events` rows of type 'missed_enquiry'
 *   inside the window, measured on `occurred_at`.
 *
 *   findCancellations — reservations with `status = 'cancelled'` and a
 *   `cancelled_at` inside the window. No follow-up predicate: a
 *   cancellation that already received a rebook offer still represents
 *   a lost table.
 *
 *   findNoShows — reservations flagged by the Gate #4 no-show monitor,
 *   windowed on `no_show_detected_at`. Same reasoning as cancellations.
 *
 * The fourth opportunity type — slow days — is NOT a new scan. It is the
 * Gate #2 scan, and the callers already run it: the summary route and the
 * morning brief call `detectSlowDaysForTenant(drizzleSlowDayStore, ...)`
 * once per tenant and hand the report to `buildTenantOpportunity`, so a
 * tenant's reservation history is read once, not twice, per request.
 *
 * Cross-tenant, for the super-admin "Platform Total Opportunity" KPI,
 * `fetchCrossTenantOpportunityInputs` reads the three opportunity scans
 * for the whole platform in one batch of queries. The Gate #2 data is
 * not re-read: the admin page already fetched `fetchSlowDayAggregatesByTenant`
 * (./slow-days-store.ts) for its "Slow Days Detected" KPI and hands it
 * to `calculatePlatformOpportunity` (./opportunity.ts) alongside these
 * inputs. One shared fetch, two KPIs, zero extra reservation queries.
 */

export const drizzleOpportunityStore: OpportunityStore = {
  /**
   * Valued missed-enquiry events inside the window. `estimated_value_cents
   * >= 1` keeps the scan to rows that are worth summing; a zero-value
   * missed enquiry contributes nothing to any of the three summary
   * numbers.
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
   * Cancellations inside the window, measured from `cancelled_at`.
   * `cancelled_at IS NOT NULL` is in the WHERE clause because the column
   * is nullable (pre-Gate #3 rows) and the window is measured from it.
   */
  async findCancellations({ tenantId, start, end }): Promise<CancellationLike[]> {
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
   * Detected no-shows inside the window, measured from
   * `no_show_detected_at`. The Gate #4 monitor does not flip `status`
   * (that is a staff decision), so `no_show_detected = true` is the
   * marker, and the window is measured from the detection timestamp
   * rather than the booking date — a no-show is a missed table from the
   * moment it was detected.
   */
  async findNoShows({ tenantId, start, end }): Promise<NoShowLike[]> {
    const rows = await db
      .select({
        partySize: reservations.partySize,
        detectedAt: reservations.noShowDetectedAt,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.tenantId, tenantId),
          eq(reservations.noShowDetected, true),
          isNotNull(reservations.noShowDetectedAt),
          gte(reservations.noShowDetectedAt, start),
          lte(reservations.noShowDetectedAt, end)
        )
      );

    return rows.flatMap((row) => {
      if (!row.detectedAt) return [];
      return [{ partySize: row.partySize, detectedAt: row.detectedAt }];
    });
  },
};

/**
 * The three opportunity scans for every tenant on the platform, grouped
 * into the {@link OpportunityInputs} shape the shared summarize math
 * consumes.
 *
 * This is the only platform-wide read this gate adds. The result is
 * handed to `calculatePlatformOpportunity` together with the Gate #2
 * per-tenant aggregates the admin page already fetched, so the
 * platform-wide total never issues a second read of the reservation
 * history.
 */
export async function fetchCrossTenantOpportunityInputs(
  start: Date,
  end: Date
): Promise<Map<string, OpportunityInputs>> {
  const [missedRows, cancelledRows, noShowRows] = await Promise.all([
    db
      .select({
        tenantId: revenueEvents.tenantId,
        estimatedValueCents: revenueEvents.estimatedValueCents,
        occurredAt: revenueEvents.occurredAt,
      })
      .from(revenueEvents)
      .where(
        and(
          eq(revenueEvents.eventType, 'missed_enquiry'),
          gte(revenueEvents.estimatedValueCents, 1),
          gte(revenueEvents.occurredAt, start),
          lte(revenueEvents.occurredAt, end)
        )
      ),
    db
      .select({
        tenantId: reservations.tenantId,
        partySize: reservations.partySize,
        cancelledAt: reservations.cancelledAt,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.status, 'cancelled'),
          isNotNull(reservations.cancelledAt),
          gte(reservations.cancelledAt, start),
          lte(reservations.cancelledAt, end)
        )
      ),
    db
      .select({
        tenantId: reservations.tenantId,
        partySize: reservations.partySize,
        detectedAt: reservations.noShowDetectedAt,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.noShowDetected, true),
          isNotNull(reservations.noShowDetectedAt),
          gte(reservations.noShowDetectedAt, start),
          lte(reservations.noShowDetectedAt, end)
        )
      ),
  ]);

  const byTenant = new Map<string, OpportunityInputs>();

  for (const row of missedRows) {
    const inputs = byTenant.get(row.tenantId) ?? {};
    inputs.missedEnquiries = [...(inputs.missedEnquiries ?? []), row];
    byTenant.set(row.tenantId, inputs);
  }

  for (const row of cancelledRows) {
    if (!row.cancelledAt) continue;
    const inputs = byTenant.get(row.tenantId) ?? {};
    inputs.cancellations = [
      ...(inputs.cancellations ?? []),
      { partySize: row.partySize, cancelledAt: row.cancelledAt },
    ];
    byTenant.set(row.tenantId, inputs);
  }

  for (const row of noShowRows) {
    if (!row.detectedAt) continue;
    const inputs = byTenant.get(row.tenantId) ?? {};
    inputs.noShows = [...(inputs.noShows ?? []), { partySize: row.partySize, detectedAt: row.detectedAt }];
    byTenant.set(row.tenantId, inputs);
  }

  return byTenant;
}
