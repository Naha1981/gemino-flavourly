import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  listVipAlertsToday,
  serializeVipAlert,
} from '@/lib/customer/vip-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #10 — VIP alerts raised since local midnight for the current tenant.
 * The VIP-today dashboard uses this to surface who walked in so far today.
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const alerts = await listVipAlertsToday(tenant.id, 200);

  return NextResponse.json({
    alerts: alerts.map(serializeVipAlert),
  });
}
