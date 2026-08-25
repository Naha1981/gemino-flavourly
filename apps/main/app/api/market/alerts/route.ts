import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { recentMarketAlerts } from '@/lib/market/competitor-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #16 — the tenant's competitor alerts from the last 30 days: menu
 * changes and promotions the daily sweep surfaced in the staff inbox.
 */
export async function GET(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const daysParam = Number(new URL(req.url).searchParams.get('days') ?? '30');
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 30;
  const alerts = await recentMarketAlerts(tenant.id, days);

  return NextResponse.json({ alerts, count: alerts.length, days });
}
