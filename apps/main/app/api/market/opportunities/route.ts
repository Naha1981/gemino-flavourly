import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getOpportunities, saveOpportunities } from '@/lib/market/opportunity-store';
import { analyzeOpportunities, type CompetitorEvidence } from '@/lib/market/opportunity-analyzer';
import { getLatestMenuSnapshot, listCompetitors } from '@/lib/market/competitor-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #17 — the tenant's opportunity list. Runs the analyzer over the
 * CURRENT competitor evidence and upserts the result, so the dashboard
 * always reflects the latest market state (and stale unaddressed gaps are
 * pruned automatically when the market closes them).
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitors = await listCompetitors(tenant.id);
  const evidence: CompetitorEvidence[] = await Promise.all(
    competitors.map(async (row) => {
      const snapshot = await getLatestMenuSnapshot(row.id).catch(() => null);
      const items = Array.isArray(snapshot?.menuItems)
        ? (snapshot!.menuItems as Array<{ name?: unknown; priceCents?: unknown }>)
            .filter(
              (item): item is { name: string; priceCents: number } =>
                typeof item?.name === 'string' && typeof item?.priceCents === 'number'
            )
            .map((item) => ({ name: item.name, priceCents: item.priceCents }))
        : [];
      return {
        name: row.name,
        menuText: snapshot?.menuText ?? null,
        items,
        priceLevel: row.priceLevel ? Number(row.priceLevel.replace('PRICE_LEVEL_', '')) : null,
      };
    })
  );

  // Persist the fresh analysis (upsert-by-key keeps `addressed` intact).
  await saveOpportunities(tenant.id, analyzeOpportunities(evidence, { radiusKm: 5 })).catch((err: unknown) => {
    console.error('[Opportunities] Failed to persist analysis', err);
  });

  const rows = await getOpportunities(tenant.id);
  return NextResponse.json({
    opportunities: rows.map((row) => ({
      id: row.id,
      key: row.opportunityKey,
      category: row.category,
      description: row.description,
      confidence: Number(row.confidence),
      evidence: row.evidence,
      addressed: row.addressed,
      detected_at: row.detectedAt,
    })),
  });
}
