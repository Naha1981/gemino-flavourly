import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { customerProfiles, reservations, revenueEvents } from '@/lib/db/schema';
import { and, count, eq, gte } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const DEFAULT_CONVERSION: Record<string, number> = { vip: 0.12, regular: 0.08, at_risk: 0.05, dormant: 0.03, new: 0.06, all: 0.06 };

export async function GET(req: Request) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const segment = new URL(req.url).searchParams.get('segment') || 'all';
  const allowed = ['vip', 'regular', 'at_risk', 'dormant', 'new', 'all'];
  if (!allowed.includes(segment)) return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });

  const conditions = [eq(customerProfiles.tenantId, tenant.id)];
  if (segment !== 'all') conditions.push(eq(customerProfiles.segment, segment as any));

  const since = new Date(Date.now() - 90 * 86400000);
  const [audienceRow, bookingRow, revenueRows] = await Promise.all([
    db.select({ count: count() }).from(customerProfiles).where(and(...conditions)).catch(() => [{ count: 0 }]),
    db.select({ count: count() }).from(reservations).where(and(eq(reservations.tenantId, tenant.id), gte(reservations.createdAt, since))).catch(() => [{ count: 0 }]),
    db.select({ cents: revenueEvents.realizedCents }).from(revenueEvents).where(and(eq(revenueEvents.tenantId, tenant.id), gte(revenueEvents.occurredAt, since))).catch(() => []),
  ]);

  const audience = Number((audienceRow as any)[0]?.count ?? 0);
  const bookings = Number((bookingRow as any)[0]?.count ?? 0);
  const realizedRevenue = (revenueRows as Array<{ cents: number | null }>).reduce((sum, row) => sum + (Number(row.cents) || 0), 0);
  const avgBookingValue = bookings > 0 ? Math.round(realizedRevenue / bookings) : 35000;
  const conversionRate = DEFAULT_CONVERSION[segment] ?? 0.06;
  const projectedBookings = Math.max(0, Math.round(audience * conversionRate));

  return NextResponse.json({
    projection: true,
    segment,
    audience,
    conversionRate,
    projectedBookings,
    projectedRevenueCents: projectedBookings * avgBookingValue,
    avgBookingValueCents: avgBookingValue,
    basis: { historical90dBookings: bookings, historical90dRealizedRevenueCents: realizedRevenue },
    note: 'Planning estimate, not a promise. Conversion rates are conservative defaults until this restaurant has enough campaign history.',
  });
}
