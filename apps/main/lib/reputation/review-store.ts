import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { googlePlacesConfig, googleReviews, tenants } from '@/lib/db/schema';
import { decryptSecret, encryptSecret } from './secret-box.ts';
import type { GooglePlaceReview, ReviewSentiment } from './google-places-client.ts';

/**
 * Gate #11 — Drizzle adapter for Google review monitoring. The only module
 * that reads or writes `google_reviews` / `google_places_config` rows.
 * Imported by route handlers and dashboard pages only; nothing under
 * `lib/**.test.ts` may import it (`@/lib/db` throws at import time without
 * DATABASE_URL). Framework-free tests cover the client/parser and the sync
 * runner (lib/reputation/review-sync.ts) with an in-memory store instead.
 *
 * Every query is tenant-scoped: a review belongs to exactly one tenant's
 * Google place, and even though `review_id` is globally unique (it is
 * Google's own id) every lookup ALSO filters on tenant_id, so a leaked uuid
 * can never cross tenant boundaries.
 */

export type GoogleReviewRow = typeof googleReviews.$inferSelect;
export type GooglePlacesConfigRow = typeof googlePlacesConfig.$inferSelect;

/** Shape returned by list endpoints (camelCase + a few display helpers). */
export function serializeReview(row: GoogleReviewRow) {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    google_place_id: row.googlePlaceId,
    review_id: row.reviewId,
    author_name: row.authorName,
    rating: row.rating,
    text: row.text,
    time: row.time,
    sentiment: row.sentiment as 'positive' | 'neutral' | 'negative',
    response_text: row.responseText,
    response_sent_at: row.responseSentAt,
    created_at: row.createdAt,
  };
}

/**
 * Insert a review fetched from Google, or update the row for an already
 * known review_id. The conflict update refreshes ONLY the fields Google
 * owns (text/rating/sentiment/time/author) — it deliberately never touches
 * `response_text` / `response_sent_at`, so an owner-edited draft or a
 * "sent" stamp survives every re-fetch of the same review.
 *
 * `inserted` comes from Postgres's `xmax = 0` system column: true only for
 * rows created by THIS statement, which is how the cron knows which reviews
 * are new (and therefore need a drafted response).
 */
export async function upsertReview(
  tenantId: string,
  googlePlaceId: string,
  review: GooglePlaceReview
): Promise<{ row: GoogleReviewRow; inserted: boolean }> {
  // Look-before-write rather than ON CONFLICT: the conflict target can only
  // be the globally-unique review_id, but the existing-row check is ALSO
  // tenant-scoped, so this function can never "update" another tenant's row
  // even if ids somehow collided. The update refreshes ONLY the fields
  // Google owns — response drafts and sent stamps survive every re-fetch.
  const [existing] = await db
    .select({ id: googleReviews.id })
    .from(googleReviews)
    .where(and(eq(googleReviews.tenantId, tenantId), eq(googleReviews.reviewId, review.reviewId)))
    .limit(1);

  const googleOwned = {
    googlePlaceId,
    authorName: review.authorName,
    rating: review.rating,
    text: review.text,
    time: review.time,
    sentiment: review.sentiment,
  };

  if (existing) {
    const [row] = await db
      .update(googleReviews)
      .set(googleOwned)
      .where(eq(googleReviews.id, existing.id))
      .returning();
    return { row, inserted: false };
  }

  try {
    const [row] = await db
      .insert(googleReviews)
      .values({ tenantId, reviewId: review.reviewId, ...googleOwned })
      .returning();
    return { row, inserted: true };
  } catch (err) {
    // Two overlapping runs raced between the SELECT and the INSERT; the
    // unique review_id constraint did its job. Fall back to the update path.
    if ((err as { code?: string }).code === '23505') {
      const [row] = await db
        .update(googleReviews)
        .set(googleOwned)
        .where(and(eq(googleReviews.tenantId, tenantId), eq(googleReviews.reviewId, review.reviewId)))
        .returning();
      if (row) return { row, inserted: false };
    }
    throw err;
  }
}

export interface ReviewFilters {
  rating?: number;
  sentiment?: ReviewSentiment;
}

/** Paginated review list, newest first, tenant-scoped + optional filters. */
export async function getReviews(
  tenantId: string,
  limit = 50,
  offset = 0,
  filters: ReviewFilters = {}
): Promise<GoogleReviewRow[]> {
  const conditions = [eq(googleReviews.tenantId, tenantId)];
  if (filters.rating !== undefined && Number.isInteger(filters.rating)) {
    conditions.push(eq(googleReviews.rating, filters.rating));
  }
  if (filters.sentiment) {
    conditions.push(eq(googleReviews.sentiment, filters.sentiment));
  }
  return db
    .select()
    .from(googleReviews)
    .where(and(...conditions))
    .orderBy(desc(googleReviews.time))
    .limit(limit)
    .offset(offset);
}

export async function countReviews(tenantId: string, filters: ReviewFilters = {}): Promise<number> {
  const conditions = [eq(googleReviews.tenantId, tenantId)];
  if (filters.rating !== undefined && Number.isInteger(filters.rating)) {
    conditions.push(eq(googleReviews.rating, filters.rating));
  }
  if (filters.sentiment) {
    conditions.push(eq(googleReviews.sentiment, filters.sentiment));
  }
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(googleReviews)
    .where(and(...conditions));
  return Number(row?.value ?? 0);
}

/** Single review lookup — tenant-scoped so a leaked id stays useless. */
export async function getReviewByGoogleId(
  tenantId: string,
  reviewId: string
): Promise<GoogleReviewRow | null> {
  const [row] = await db
    .select()
    .from(googleReviews)
    .where(and(eq(googleReviews.tenantId, tenantId), eq(googleReviews.reviewId, reviewId)))
    .limit(1);
  return row ?? null;
}

export interface RatingCounts {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

/** Counts per star rating (1-5). Zero-filled so the UI can render bars. */
export async function countByRating(tenantId: string): Promise<RatingCounts> {
  const rows = await db
    .select({ rating: googleReviews.rating, value: sql<number>`count(*)::int` })
    .from(googleReviews)
    .where(eq(googleReviews.tenantId, tenantId))
    .groupBy(googleReviews.rating);

  const counts: RatingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) {
    if (row.rating >= 1 && row.rating <= 5) {
      counts[row.rating as keyof RatingCounts] = Number(row.value);
    }
  }
  return counts;
}

/** Average star rating across all stored reviews, 0 when none yet. */
export async function getAverageRating(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`COALESCE(AVG(${googleReviews.rating}), 0)::float` })
    .from(googleReviews)
    .where(eq(googleReviews.tenantId, tenantId));
  return Number(row?.value ?? 0);
}

export interface SentimentBreakdown {
  positive: number;
  neutral: number;
  negative: number;
}

export async function sentimentBreakdown(tenantId: string): Promise<SentimentBreakdown> {
  const rows = await db
    .select({ sentiment: googleReviews.sentiment, value: sql<number>`count(*)::int` })
    .from(googleReviews)
    .where(eq(googleReviews.tenantId, tenantId))
    .groupBy(googleReviews.sentiment);

  const breakdown: SentimentBreakdown = { positive: 0, neutral: 0, negative: 0 };
  for (const row of rows) {
    if (row.sentiment === 'positive' || row.sentiment === 'neutral' || row.sentiment === 'negative') {
      breakdown[row.sentiment] = Number(row.value);
    }
  }
  return breakdown;
}

// -----------------------------------------------------------------------------
// Places configuration (one row per tenant)
// -----------------------------------------------------------------------------

/**
 * Save (or update) the tenant's Google Places configuration. The API key is
 * encrypted at rest; pass `apiKey: null` to keep whatever is already stored
 * (the settings UI never echoes the key back, so "save place id only" must
 * not wipe the key).
 */
export async function savePlaceConfig(
  tenantId: string,
  placeId: string,
  apiKey: string | null
): Promise<GooglePlacesConfigRow> {
  const [row] = await db
    .insert(googlePlacesConfig)
    .values({
      tenantId,
      placeId,
      apiKeyEncrypted: apiKey ? encryptSecret(apiKey) : null,
    })
    .onConflictDoUpdate({
      target: googlePlacesConfig.tenantId,
      set: {
        placeId,
        ...(apiKey ? { apiKeyEncrypted: encryptSecret(apiKey) } : {}),
      },
    })
    .returning();
  return row;
}

export async function getPlaceConfig(tenantId: string): Promise<GooglePlacesConfigRow | null> {
  const [row] = await db
    .select()
    .from(googlePlacesConfig)
    .where(eq(googlePlacesConfig.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

/** Public-safe config shape: the API key is never echoed, only its presence. */
export function serializePlaceConfig(row: GooglePlacesConfigRow | null) {
  if (!row) return null;
  return {
    place_id: row.placeId,
    has_api_key: Boolean(row.apiKeyEncrypted && decryptSecret(row.apiKeyEncrypted)),
    last_fetch_at: row.lastFetchAt,
    created_at: row.createdAt,
  };
}

/**
 * All tenant configs with DECRYPTED keys, for the fetch cron. Tenants whose
 * key cannot be decrypted (rotated master key) come back with apiKey: null
 * and are skipped (and counted) by the runner rather than crashing the run.
 */
export async function findAllPlaceConfigs(): Promise<
  Array<{ tenantId: string; placeId: string; apiKey: string | null }>
> {
  const rows = await db
    .select({
      tenantId: googlePlacesConfig.tenantId,
      placeId: googlePlacesConfig.placeId,
      apiKeyEncrypted: googlePlacesConfig.apiKeyEncrypted,
    })
    .from(googlePlacesConfig)
    .innerJoin(tenants, eq(tenants.id, googlePlacesConfig.tenantId));
  return rows.map((row) => ({
    tenantId: row.tenantId,
    placeId: row.placeId,
    apiKey: row.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : null,
  }));
}

export async function touchLastFetchAt(tenantId: string, at: Date): Promise<void> {
  await db
    .update(googlePlacesConfig)
    .set({ lastFetchAt: at })
    .where(eq(googlePlacesConfig.tenantId, tenantId));
}

// -----------------------------------------------------------------------------
// Response drafts (Gate #12) — mutations used by the API + cron
// -----------------------------------------------------------------------------

/** Owner edits a draft. Tenant-scoped; returns false when the review isn't theirs. */
export async function updateResponseDraft(
  tenantId: string,
  reviewId: string,
  responseText: string
): Promise<boolean> {
  const rows = await db
    .update(googleReviews)
    .set({ responseText })
    .where(and(eq(googleReviews.tenantId, tenantId), eq(googleReviews.reviewId, reviewId)))
    .returning({ id: googleReviews.id });
  return rows.length > 0;
}

/**
 * Stamp the draft ONLY when none exists (and it has not been sent): the
 * cron calls this on re-fetch, and it must never overwrite a draft the
 * owner already edited or approved-and-sent.
 */
export async function setResponseDraftIfAbsent(
  tenantId: string,
  reviewId: string,
  draft: string
): Promise<boolean> {
  const rows = await db
    .update(googleReviews)
    .set({ responseText: draft })
    .where(
      and(
        eq(googleReviews.tenantId, tenantId),
        eq(googleReviews.reviewId, reviewId),
        sql`${googleReviews.responseText} IS NULL`,
        sql`${googleReviews.responseSentAt} IS NULL`
      )
    )
    .returning({ id: googleReviews.id });
  return rows.length > 0;
}

/**
 * Mark a response as sent (posted by the owner to Google). Idempotent-ish:
 * a second call succeeds but the UI shows the first timestamp.
 */
export async function markResponseSent(tenantId: string, reviewId: string, at: Date): Promise<Date | null> {
  const [row] = await db
    .update(googleReviews)
    .set({ responseSentAt: at })
    .where(and(eq(googleReviews.tenantId, tenantId), eq(googleReviews.reviewId, reviewId)))
    .returning({ sentAt: googleReviews.responseSentAt });
  return row?.sentAt ?? null;
}

/** The cron-facing adapter (subset of the store the runner needs). */
export const drizzleReviewSyncStore = {
  findActiveConfigs: findAllPlaceConfigs,
  upsertReview,
  setResponseDraftIfAbsent,
  touchLastFetchAt,
};
