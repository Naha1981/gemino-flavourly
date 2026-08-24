import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { recentMarketAlerts } from '@/lib/market/competitor-store';

export const dynamic = 'force-dynamic';

/** Gate #16 — the tenant's market alerts (menu changes + promotions), last 30 days. */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const alerts = await recentMarketAlerts(tenant.id, 30);
  return NextResponse.json({ alerts });
}
