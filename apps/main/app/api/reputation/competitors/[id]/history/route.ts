import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getRatingHistory } from '@/lib/reputation/competitor-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #14 — rating history for one competitor (the trend chart's data).
 * Tenant-scoped through getRatingHistory, which joins the competitor row.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Empty history is the honest answer for both a brand-new competitor and
  // a foreign id: getRatingHistory only sees this tenant's rows either way.
  const history = await getRatingHistory(tenant.id, params.id, 90);

  return NextResponse.json({
    history: history.map((row) => ({
      id: row.id,
      rating: Number(row.rating),
      review_count: row.reviewCount,
      recorded_at: row.recordedAt,
    })),
  });
}
