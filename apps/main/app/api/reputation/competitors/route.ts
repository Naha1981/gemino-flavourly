import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { createCompetitor, listCompetitors, competitorTrend, getRatingHistory } from '@/lib/reputation/competitor-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #14 — competitor list + add. Every row returned/mutated is scoped to
 * the signed-in tenant; the trend badge comes from the stored rating history.
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await listCompetitors(tenant.id);
  const withTrends = await Promise.all(
    rows.map(async (row) => {
      const history = await getRatingHistory(tenant.id, row.id, 30);
      return {
        id: row.id,
        name: row.name,
        google_place_id: row.googlePlaceId,
        current_rating: Number(row.currentRating),
        review_count: row.reviewCount,
        last_check_at: row.lastCheckAt,
        created_at: row.createdAt,
        trend: competitorTrend(history),
      };
    })
  );

  return NextResponse.json({ competitors: withTrends });
}

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { name?: unknown; place_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const placeId = typeof body.place_id === 'string' ? body.place_id.trim() : '';
  if (!name || name.length > 120) {
    return NextResponse.json({ error: 'name is required (max 120 chars)' }, { status: 400 });
  }
  if (!placeId || placeId.length < 6 || placeId.length > 256) {
    return NextResponse.json(
      { error: 'place_id is required (Google Place IDs look like ChIJN1t_tDeuEmsRUsoyG83frY4)' },
      { status: 400 }
    );
  }

  const row = await createCompetitor(tenant.id, name, placeId);
  return NextResponse.json({
    ok: true,
    competitor: {
      id: row.id,
      name: row.name,
      google_place_id: row.googlePlaceId,
      current_rating: Number(row.currentRating),
      review_count: row.reviewCount,
      trend: 'stable',
    },
  });
}
