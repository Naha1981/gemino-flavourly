import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { googlePlacesConfig, googleReviews } from '@/lib/db/schema';
import type { GoogleReview } from './google-places-client';

export async function upsertReview(review: GoogleReview & { tenantId: string }) {
  const [row] = await db.insert(googleReviews).values({
    tenantId: review.tenantId,
    googlePlaceId: review.googlePlaceId,
    reviewId: review.reviewId,
    authorName: review.authorName,
    rating: review.rating,
    text: review.text,
    time: review.time,
    sentiment: review.sentiment,
  }).onConflictDoUpdate({
    target: googleReviews.reviewId,
    set: {
      authorName: review.authorName,
      rating: review.rating,
      text: review.text,
      time: review.time,
      sentiment: review.sentiment,
    },
  }).returning();
  return row;
}

export function getReviews(tenantId: string, limit = 50, offset = 0) {
  return db.select().from(googleReviews)
    .where(eq(googleReviews.tenantId, tenantId))
    .orderBy(desc(googleReviews.time)).limit(limit).offset(offset);
}

export function getReviewByGoogleId(tenantId: string, reviewId: string) {
  return db.query.googleReviews.findFirst({ where: and(eq(googleReviews.tenantId, tenantId), eq(googleReviews.reviewId, reviewId)) });
}

export async function countByRating(tenantId: string) {
  const rows = await db.select({ rating: googleReviews.rating, count: sql<number>`count(*)` })
    .from(googleReviews).where(eq(googleReviews.tenantId, tenantId)).groupBy(googleReviews.rating);
  return Object.fromEntries([1, 2, 3, 4, 5].map((rating) => [rating, Number(rows.find((row) => row.rating === rating)?.count || 0)]));
}

export async function getAverageRating(tenantId: string) {
  const [row] = await db.select({ average: sql<number>`coalesce(avg(${googleReviews.rating}), 0)` })
    .from(googleReviews).where(eq(googleReviews.tenantId, tenantId));
  return Number(row?.average || 0);
}

export async function savePlaceConfig(tenantId: string, placeId: string, apiKey: string) {
  const [row] = await db.insert(googlePlacesConfig).values({ tenantId, placeId, apiKeyEncrypted: apiKey })
    .onConflictDoUpdate({ target: googlePlacesConfig.tenantId, set: { placeId, apiKeyEncrypted: apiKey } }).returning();
  return row;
}

export function getPlaceConfig(tenantId: string) {
  return db.query.googlePlacesConfig.findFirst({ where: eq(googlePlacesConfig.tenantId, tenantId) });
}

export function markPlaceFetched(tenantId: string) {
  return db.update(googlePlacesConfig).set({ lastFetchAt: new Date() }).where(eq(googlePlacesConfig.tenantId, tenantId));
}
