import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  countVipAlerts,
  listVipAlerts,
  serializeVipAlert,
} from '@/lib/customer/vip-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #10 — VIP alerts for the current tenant.
 *
 * GET: the last 7 days of VIP walk-in alerts, newest first, scoped to the
 * signed-in tenant. Alerts are staff-only; they are never shown to customers.
 */
export async function GET(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const [alerts, total] = await Promise.all([
    listVipAlerts(tenant.id, limit, offset),
    countVipAlerts(tenant.id),
  ]);

  return NextResponse.json({
    alerts: alerts.map(serializeVipAlert),
    pagination: { limit, offset, total },
  });
}
