import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getOpportunities } from '@/lib/market/opportunity-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #17 — the tenant's detected market opportunities, best first.
 *
 * Rows are written by POST /api/market/opportunities/analyze (and by the
 * daily cron); this endpoint only reads, so opening the page is cheap.
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await getOpportunities(tenant.id);

  return NextResponse.json({
    opportunities: rows.map((row) => ({
      id: row.id,
      key: row.key,
      opportunity_type: row.opportunityType,
      title: row.title,
      description: row.description,
      confidence: Number(row.confidence),
      evidence: (row.evidence as string[] | null) ?? [],
      addressed: row.addressed,
      addressed_at: row.addressedAt,
      detected_at: row.detectedAt,
      updated_at: row.updatedAt,
    })),
    count: rows.length,
  });
}
