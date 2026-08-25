import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { marketingCampaigns, marketingEvents } from '@/lib/db/schema';
import { and, eq, gte, lte, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
}

export async function GET(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const monthParam = url.searchParams.get('month');
  const now = new Date();
  const month = monthParam ? new Date(monthParam + '-01') : now;
  if (Number.isNaN(month.getTime())) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  }

  const rangeStart = startOfMonth(month);
  const rangeEnd = endOfMonth(month);

  const [campaigns, events] = await Promise.all([
    db.select().from(marketingCampaigns).where(
      and(
        eq(marketingCampaigns.tenantId, tenant.id),
        sql`(${marketingCampaigns.startDate} IS NOT NULL AND ${marketingCampaigns.startDate} <= ${rangeEnd}) OR (${marketingCampaigns.endDate} IS NOT NULL AND ${marketingCampaigns.endDate} >= ${rangeStart}) OR (${marketingCampaigns.launchedAt} IS NOT NULL AND ${marketingCampaigns.launchedAt} >= ${rangeStart} AND ${marketingCampaigns.launchedAt} <= ${rangeEnd})`
      )
    ).orderBy(marketingCampaigns.startDate),
    db.select().from(marketingEvents).where(
      and(
        eq(marketingEvents.tenantId, tenant.id),
        sql`(${marketingEvents.startsAt} <= ${rangeEnd} AND ${marketingEvents.endsAt} >= ${rangeStart})`
      )
    ).orderBy(marketingEvents.startsAt),
  ]);

  const items = [
    ...campaigns.map((c) => ({
      id: c.id,
      kind: 'campaign' as const,
      name: c.name,
      type: c.type,
      status: c.status,
      startsAt: c.startDate,
      endsAt: c.endDate,
      launchedAt: c.launchedAt,
      message: c.message,
    })),
    ...events.map((e) => ({
      id: e.id,
      kind: 'event' as const,
      name: e.name,
      type: e.eventType,
      status: e.status,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      location: e.location,
      message: e.message,
    })),
  ].sort((a, b) => new Date(a.startsAt ?? '').getTime() - new Date(b.startsAt ?? '').getTime());

  return NextResponse.json({
    month: month.toISOString().slice(0, 7),
    items,
  });
}
