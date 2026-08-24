import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  countByRating,
  countReviews,
  getAverageRating,
  getReviews,
  sentimentBreakdown,
  type ReviewFilters,
} from '@/lib/reputation/review-store';
import type { ReviewSentiment } from '@/lib/reputation/google-places-client';

export const dynamic = 'force-dynamic';

/**
 * Gate #11 — review list for the reputation dashboard. Paginated, newest
 * first, filterable by rating (1-5) and sentiment. Tenant-scoped through
 * getOrCreateTenant + every store read.
 */
export async function GET(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 200);
  const offset = Math.max(Number(params.get('offset')) || 0, 0);

  const ratingParam = Number(params.get('rating'));
  const sentimentParam = params.get('sentiment');
  const filters: ReviewFilters = {};
  if (Number.isInteger(ratingParam) && ratingParam >= 1 && ratingParam <= 5) {
    filters.rating = ratingParam;
  }
  if (sentimentParam === 'positive' || sentimentParam === 'neutral' || sentimentParam === 'negative') {
    filters.sentiment = sentimentParam as ReviewSentiment;
  }

  const [reviews, total] = await Promise.all([
    getReviews(tenant.id, limit, offset, filters),
    countReviews(tenant.id, filters),
  ]);

  return NextResponse.json({
    reviews: reviews.map((row) => ({
      id: row.id,
      review_id: row.reviewId,
      author_name: row.authorName,
      rating: row.rating,
      text: row.text,
      time: row.time,
      sentiment: row.sentiment,
      response_text: row.responseText,
      response_sent_at: row.responseSentAt,
    })),
    pagination: { total, limit, offset },
  });
}
