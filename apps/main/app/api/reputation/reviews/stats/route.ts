import { NextResponse } from 'next/server';
import { countByRating, getAverageRating, getReviews } from '@/lib/reputation/review-store';
import { getOrCreateTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [ratings, average, reviews] = await Promise.all([countByRating(tenant.id), getAverageRating(tenant.id), getReviews(tenant.id, 1000)]);
  return NextResponse.json({ total: reviews.length, average, ratings, sentiment: {
    positive: reviews.filter((review) => review.sentiment === 'positive').length,
    neutral: reviews.filter((review) => review.sentiment === 'neutral').length,
    negative: reviews.filter((review) => review.sentiment === 'negative').length,
  } });
}