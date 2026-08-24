import { and, eq, gte, lt, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { reservations } from '@/lib/db/schema';
import type { DayAggregate, ReservationLike, SlowDayStore } from './slow-days';

/**
 * Drizzle adapter for the slow-day analytics in ./slow-days.ts.
 *
 * The analytics themselves take a {@link SlowDayStore} so they stay
 * framework-free and unit-testable; this file is the only place that
 * knows how to read the `reservations` table. Imported by route handlers
 * only — it pulls in `@/lib/db`, which requires DATABASE_URL at import
 * time, so nothing in `lib/**.test.ts` may import it.
 */

/**
 * One tenant's reservation history for the analysis window.
 *
 * `end` is exclusive: callers pass midnight of "today" so an in-progress
 * day (whose bookings are still arriving) is never compared against a
 * complete day's average. Cancelled rows are filtered here to keep the
 * window small; `toDayAggregates` applies the same rule again for callers
 * that hand it raw rows.
 */
export const drizzleSlowDayStore: SlowDayStore = {
  async findReservations({ tenantId, start, end }): Promise<ReservationLike[]> {
    return db
      .select({
        date: reservations.date,
        partySize: reservations.partySize,
        status: reservations.status,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.tenantId, tenantId),
          gte(reservations.date, start),
          lt(reservations.date, end),
          ne(reservations.status, 'cancelled')
        )
      );
  },
};

/**
 * Per-tenant, per-day booking/guest counts for the super-admin dashboard.
 *
 * The dashboard needs a slow-day count across *every* tenant, and fetching
 * 97 days of raw reservation rows for the whole platform just to count
 * them would be pointless work. The grouping happens in Postgres instead:
 * one row per (tenant, calendar day), which `analyzeDayAggregates` can
 * consume directly.
 *
 * `to_char(date, 'YYYY-MM-DD')` buckets on the stored wall-clock value,
 * which is exactly what the analytics do with a Date column (Drizzle maps
 * `timestamp` values with an explicit +0000 offset), so the two agree.
 */
export async function fetchSlowDayAggregatesByTenant(start: Date, end: Date): Promise<Map<string, DayAggregate[]>> {
  const dayExpression = sql`to_char(${reservations.date}, 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      tenantId: reservations.tenantId,
      day: sql<string>`${dayExpression}`,
      bookings: sql<number>`count(*)::int`,
      guests: sql<number>`coalesce(sum(${reservations.partySize}), 0)::int`,
    })
    .from(reservations)
    .where(and(gte(reservations.date, start), lt(reservations.date, end), ne(reservations.status, 'cancelled')))
    .groupBy(reservations.tenantId, dayExpression);

  const byTenant = new Map<string, DayAggregate[]>();
  for (const row of rows) {
    const list = byTenant.get(row.tenantId) ?? [];
    list.push({
      day: row.day,
      bookings: Number(row.bookings) || 0,
      guests: Number(row.guests) || 0,
    });
    byTenant.set(row.tenantId, list);
  }
  return byTenant;
}
