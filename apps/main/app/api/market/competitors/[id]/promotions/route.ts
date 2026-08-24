import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getCompetitor, listPromotionsForCompetitor } from '@/lib/market/competitor-store';

export const dynamic = 'force-dynamic';

/** Gate #16 — promotion timeline for one competitor (last 90 days). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitor = await getCompetitor(tenant.id, params.id);
  if (!competitor) {
    return NextResponse.json({ error: 'Competitor not found' }, { status: 404 });
  }

  const promotions = await listPromotionsForCompetitor(tenant.id, params.id, 90);
  return NextResponse.json({
    competitor: { id: competitor.id, name: competitor.name },
    promotions: promotions.map((row) => ({
      id: row.id,
      promotion_text: row.promotionText,
      source: row.source,
      detected_at: row.detectedAt,
    })),
  });
}
