import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { listPromotions } from '@/lib/market/competitor-store';

export const dynamic = 'force-dynamic';

/** Gate #16 — one competitor's promotion timeline, newest first, tenant-scoped. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = Number(new URL(req.url).searchParams.get('limit') ?? '50');
  const rows = await listPromotions(tenant.id, params.id, Number.isFinite(limit) ? limit : 50);

  return NextResponse.json({
    competitor_id: params.id,
    promotions: rows.map((row) => ({
      id: row.id,
      promotion_text: row.promotionText,
      source: row.source,
      detected_at: row.detectedAt,
    })),
  });
}
