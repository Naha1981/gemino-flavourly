import { fetchReviews, type GooglePlaceReview } from './google-places-client.ts';
import { draftReviewResponse, type ThemeClassifier } from './response-generator.ts';

/**
 * Gate #11 + #12 — review fetch cron runner, framework-free.
 *
 * One run:
 *   1. load every tenant's Google Places config (keys decrypted by the store)
 *   2. per tenant: pull the place's reviews from the Places API
 *   3. upsert each review (idempotent on Google's review id)
 *   4. for NEW reviews: draft an owner-facing response (never auto-sent)
 *   5. stamp last_fetch_at — even on partial failure, so "when did we last
 *      try" is always answerable
 *
 * Failures are isolated per tenant and per review: one restaurant's bad API
 * key must not starve the other tenants of their daily pull.
 */

export interface ReviewSyncStore {
  /** All tenant configs; apiKey null means "unreadable" (rotated key etc). */
  findActiveConfigs(): Promise<Array<{ tenantId: string; placeId: string; apiKey: string | null }>>;
  upsertReview(
    tenantId: string,
    placeId: string,
    review: GooglePlaceReview
  ): Promise<{ inserted: boolean }>;
  /** Draft a response only when the review has none yet. */
  setResponseDraftIfAbsent(tenantId: string, reviewId: string, draft: string): Promise<boolean>;
  touchLastFetchAt(tenantId: string, at: Date): Promise<void>;
}

/** Injectable fetch-reviews seam (tests pass a fixture-backed fake). */
export type FetchReviewsFn = (
  placeId: string,
  apiKey: string,
  options: { now?: Date; fetchImpl?: typeof fetch }
) => Promise<GooglePlaceReview[]>;

export interface ReviewSyncOptions {
  now?: Date;
  fetchImpl?: typeof fetch;
  fetchReviewsFn?: FetchReviewsFn;
  classifier?: ThemeClassifier;
  /** Ceiling on reviews upserted per run, across all tenants. */
  limit?: number;
}

export interface ReviewSyncSummary {
  tenantsChecked: number;
  tenantsFetched: number;
  reviewsUpserted: number;
  /** First-time reviews (drove response drafting). */
  newReviews: number;
  draftsCreated: number;
  skipped: { noApiKey: number; tenantFailed: number; reviewFailed: number };
  samples: Array<{ tenantId: string; reviewId: string; rating: number; sentiment: string }>;
}

const DEFAULT_LIMIT = 500;

function positiveLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_LIMIT;
}

export async function runReviewSyncCron(
  store: ReviewSyncStore,
  options: ReviewSyncOptions = {}
): Promise<ReviewSyncSummary> {
  const now = options.now ?? new Date();
  const doFetchReviews = options.fetchReviewsFn ?? fetchReviews;

  const summary: ReviewSyncSummary = {
    tenantsChecked: 0,
    tenantsFetched: 0,
    reviewsUpserted: 0,
    newReviews: 0,
    draftsCreated: 0,
    skipped: { noApiKey: 0, tenantFailed: 0, reviewFailed: 0 },
    samples: [],
  };

  let configs: Awaited<ReturnType<ReviewSyncStore['findActiveConfigs']>> = [];
  try {
    configs = await store.findActiveConfigs();
  } catch (err) {
    console.error('[ReviewSync] Failed to load tenant configs', err);
    summary.skipped.tenantFailed += 1;
    return summary;
  }
  summary.tenantsChecked = configs.length;

  for (const config of configs) {
    if (!config.apiKey) {
      // Unreadable key (rotated master key or never-stored): skip loudly so
      // the operator sees it in the logs rather than wondering why this
      // tenant's reviews stopped updating.
      console.error(
        `[ReviewSync] No readable API key for tenant ${config.tenantId} — re-save the Google Places config`
      );
      summary.skipped.noApiKey += 1;
      continue;
    }

    let reviews: GooglePlaceReview[];
    try {
      reviews = await doFetchReviews(config.placeId, config.apiKey, { now });
    } catch (err) {
      console.error(`[ReviewSync] Places fetch failed for tenant ${config.tenantId}`, err);
      summary.skipped.tenantFailed += 1;
      continue;
    }
    summary.tenantsFetched += 1;

    for (const review of reviews) {
      if (summary.reviewsUpserted >= positiveLimit(options.limit)) {
        return finish(summary, store, configs, now);
      }

      try {
        const { inserted } = await store.upsertReview(config.tenantId, config.placeId, review);
        summary.reviewsUpserted += 1;

        if (inserted) {
          summary.newReviews += 1;
          if (summary.samples.length < 5) {
            summary.samples.push({
              tenantId: config.tenantId,
              reviewId: review.reviewId,
              rating: review.rating,
              sentiment: review.sentiment,
            });
          }

          // Gate #12: draft an owner-facing response for every NEW review.
          // The draft function never throws (LLM failures degrade to the
          // deterministic template), and setResponseDraftIfAbsent means a
          // re-fetch can never overwrite an owner-edited draft.
          try {
            const draft = await draftReviewResponse(
              { authorName: review.authorName, rating: review.rating, text: review.text, sentiment: review.sentiment },
              {},
              { classifier: options.classifier, now }
            );
            if (await store.setResponseDraftIfAbsent(config.tenantId, review.reviewId, draft)) {
              summary.draftsCreated += 1;
            }
          } catch (err) {
            console.error(`[ReviewSync] Drafting failed for review ${review.reviewId}`, err);
          }
        }
      } catch (err) {
        summary.skipped.reviewFailed += 1;
        console.error(`[ReviewSync] Upsert failed for review ${review.reviewId}`, err);
      }
    }

    await store.touchLastFetchAt(config.tenantId, now).catch((err: unknown) => {
      console.error(`[ReviewSync] Failed to stamp last_fetch_at for tenant ${config.tenantId}`, err);
    });
  }

  return summary;
}

/** last_fetch_at is stamped even when the limit cut the run short. */
async function finish(
  summary: ReviewSyncSummary,
  store: ReviewSyncStore,
  configs: Array<{ tenantId: string }>,
  now: Date
): Promise<ReviewSyncSummary> {
  for (const config of configs) {
    await store.touchLastFetchAt(config.tenantId, now).catch(() => undefined);
  }
  return summary;
}
