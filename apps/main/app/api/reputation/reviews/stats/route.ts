import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  countByRating,
  countReviews,
  getAverageRating,
  sentimentBreakdown,
} from '@/lib/reputation/review-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #11 — review metrics header: total, average, counts by star rating,
 * sentiment breakdown. One number set, three store reads, all tenant-scoped.
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [total, average, byRating, bySentiment] = await Promise.all([
    countReviews(tenant.id),
    getAverageRating(tenant.id),
    countByRating(tenant.id),
    sentimentBreakdown(tenant.id),
  ]);

  return NextResponse.json({
    total,
    average_rating: Math.round(average * 10) / 10,
    counts_by_rating: byRating,
    sentiment: bySentiment,
  });
}
