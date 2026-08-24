import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { campaignStats } from '@/lib/customer/reactivation-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #9 — campaign metrics for the current tenant:
 * total, pending, sent, responded, and responseRate (responded/sent).
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = await campaignStats(tenant.id);
  return NextResponse.json({
    stats: {
      ...stats,
      // The rounded percentages the dashboard renders ("24 sent, 8
      // responded (33%)") alongside the exact ratio.
      responseRatePercent: Math.round(stats.responseRate * 100),
    },
  });
}
