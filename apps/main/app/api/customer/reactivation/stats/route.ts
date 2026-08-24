import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { campaignStats } from '@/lib/customer/reactivation-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #9 — reactivation campaign metrics for the signed-in tenant:
 * totals plus sent / responded / response_rate for the dashboard's
 * "24 sent, 8 responded (33%)" line.
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = await campaignStats(tenant.id);
  return NextResponse.json({ stats });
}
