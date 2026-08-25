import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getPositioningReport } from '@/lib/market/positioning-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #18 — the tenant's positioning report: price band, Google rating rank,
 * menu overlap and unique offerings, computed from stored data only (no
 * outbound calls), so the page can be opened as often as the owner likes.
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const report = await getPositioningReport(tenant.id, { now: new Date() });
  return NextResponse.json({ report });
}
