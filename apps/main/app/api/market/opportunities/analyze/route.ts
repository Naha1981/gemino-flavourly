import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { refreshOpportunities } from '@/lib/market/opportunity-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Gate #17 — run the opportunity analysis now.
 *
 * Reads only what is already stored (competitors + their newest menu
 * snapshot), so it issues no outbound HTTP: the dashboard button can be
 * clicked as often as the owner likes. Upserts by (tenant_id, key), which
 * refreshes a known gap without ever clearing its "addressed" flag.
 */
export async function POST() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { analysed, opportunities } = await refreshOpportunities(tenant.id);

  return NextResponse.json({
    ok: true,
    competitors_analysed: analysed,
    opportunities: opportunities.map((opportunity) => ({
      key: opportunity.key,
      opportunity_type: opportunity.opportunityType,
      title: opportunity.title,
      confidence: opportunity.confidence,
    })),
  });
}
