import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runReviewSyncCron, type ReviewSyncStore } from './review-sync.ts';
import type { GooglePlaceReview } from './google-places-client.ts';

const NOW = new Date('2026-08-20T06:00:00Z');

function fixtureReview(overrides: Partial<GooglePlaceReview> = {}): GooglePlaceReview {
  return {
    reviewId: `r-${Math.random().toString(36).slice(2, 8)}`,
    authorName: 'Thabo',
    rating: 5,
    text: 'Great ribs',
    time: NOW,
    sentiment: 'positive',
    ...overrides,
  };
}

interface StoredReview {
  tenantId: string;
  placeId: string;
  review: GooglePlaceReview;
  responseText: string | null;
  responseSentAt: Date | null;
}

/**
 * In-memory store mirroring the Drizzle adapter's semantics exactly:
 * upsert dedupes on review_id, setResponseDraftIfAbsent only fills empties.
 */
function memoryStore(existing: StoredReview[] = []) {
  const state = {
    reviews: new Map<string, StoredReview>(existing.map((r) => [r.review.reviewId, r])),
    touchedAt: new Map<string, Date>(),
  };
  const store: ReviewSyncStore & { state: typeof state } = {
    state,
    async findActiveConfigs() {
      return [
        { tenantId: 'tenant-a', placeId: 'place-a', apiKey: 'key-a' },
        { tenantId: 'tenant-b', placeId: 'place-b', apiKey: null },
      ];
    },
    async upsertReview(tenantId, placeId, review) {
      const existingRow = state.reviews.get(review.reviewId);
      if (existingRow) {
        existingRow.review = review;
        return { inserted: false };
      }
      state.reviews.set(review.reviewId, {
        tenantId,
        placeId,
        review,
        responseText: null,
        responseSentAt: null,
      });
      return { inserted: true };
    },
    async setResponseDraftIfAbsent(tenantId, reviewId, draft) {
      const row = state.reviews.get(reviewId);
      if (!row || row.tenantId !== tenantId || row.responseText !== null || row.responseSentAt !== null) {
        return false;
      }
      row.responseText = draft;
      return true;
    },
    async touchLastFetchAt(tenantId, at) {
      state.touchedAt.set(tenantId, at);
    },
  };
  return store;
}

describe('runReviewSyncCron (Gate #11 integration semantics)', () => {
  test('happy path: fetches per tenant, upserts, drafts responses for NEW reviews, stamps last_fetch_at', async () => {
    const store = memoryStore();
    const newReview = fixtureReview({ reviewId: 'fresh-1', rating: 4, text: 'Lovely evening' });
    const summary = await runReviewSyncCron(store, {
      now: NOW,
      fetchReviewsFn: async (placeId) => {
        assert.equal(placeId, 'place-a'); // tenant-b has no readable key
        return [newReview];
      },
    });

    assert.equal(summary.tenantsChecked, 2);
    assert.equal(summary.tenantsFetched, 1);
    assert.equal(summary.reviewsUpserted, 1);
    assert.equal(summary.newReviews, 1);
    assert.equal(summary.draftsCreated, 1);
    assert.equal(summary.skipped.noApiKey, 1); // tenant-b skipped, not crashed
    assert.equal(store.state.touchedAt.get('tenant-a')?.getTime(), NOW.getTime());

    const stored = store.state.reviews.get('fresh-1')!;
    assert.equal(stored.tenantId, 'tenant-a');
    assert.match(stored.responseText!, /Thank you so much, Thabo!/);
  });

  test('already-known reviews are updated but NOT re-drafted', async () => {
    const known = fixtureReview({ reviewId: 'known-1', rating: 5 });
    const store = memoryStore([
      { tenantId: 'tenant-a', placeId: 'place-a', review: known, responseText: 'Owner edited this', responseSentAt: null },
    ]);
    const updated = fixtureReview({ reviewId: 'known-1', rating: 4, text: 'changed my mind, 4 stars' });

    const summary = await runReviewSyncCron(store, {
      now: NOW,
      fetchReviewsFn: async () => [updated],
    });

    assert.equal(summary.reviewsUpserted, 1);
    assert.equal(summary.newReviews, 0);
    assert.equal(summary.draftsCreated, 0);
    // Owner's edit survives the re-fetch.
    assert.equal(store.state.reviews.get('known-1')!.responseText, 'Owner edited this');
  });

  test('one tenant API failure isolates and does not starve the others', async () => {
    const store = memoryStore();
    store.findActiveConfigs = async () => [
      { tenantId: 'bad', placeId: 'place-bad', apiKey: 'k' },
      { tenantId: 'good', placeId: 'place-good', apiKey: 'k' },
    ];

    const summary = await runReviewSyncCron(store, {
      now: NOW,
      fetchReviewsFn: async (placeId) => {
        if (placeId === 'place-bad') throw new Error('403 forbidden');
        return [fixtureReview({ reviewId: 'good-1' })];
      },
    });

    assert.equal(summary.tenantsFetched, 1);
    assert.equal(summary.skipped.tenantFailed, 1);
    assert.equal(summary.newReviews, 1);
  });

  test('a failed review upsert is counted, not thrown', async () => {
    const store = memoryStore();
    const original = store.upsertReview.bind(store);
    store.upsertReview = async () => {
      throw new Error('db hiccup');
    };
    const summary = await runReviewSyncCron(store, {
      now: NOW,
      fetchReviewsFn: async () => [fixtureReview()],
    });
    assert.equal(summary.skipped.reviewFailed, 1);
    assert.equal(summary.newReviews, 0);
    void original;
  });

  test('the per-run limit cuts the sweep short but still stamps every tenant', async () => {
    const store = memoryStore();
    store.findActiveConfigs = async () => [
      { tenantId: 't1', placeId: 'p1', apiKey: 'k' },
      { tenantId: 't2', placeId: 'p2', apiKey: 'k' },
    ];
    const summary = await runReviewSyncCron(store, {
      now: NOW,
      limit: 1,
      fetchReviewsFn: async () => [fixtureReview(), fixtureReview()],
    });
    assert.equal(summary.reviewsUpserted, 1);
    assert.equal(store.state.touchedAt.size, 2); // both tenants stamped
  });

  test('config listing failure returns an empty-but-honest summary', async () => {
    const store = memoryStore();
    store.findActiveConfigs = async () => {
      throw new Error('db down');
    };
    const summary = await runReviewSyncCron(store, { now: NOW, fetchReviewsFn: async () => [] });
    assert.equal(summary.tenantsChecked, 0);
    assert.equal(summary.skipped.tenantFailed, 1);
  });

  test('empty review payloads are a clean no-op', async () => {
    const store = memoryStore();
    const summary = await runReviewSyncCron(store, { now: NOW, fetchReviewsFn: async () => [] });
    assert.equal(summary.tenantsFetched, 1);
    assert.equal(summary.reviewsUpserted, 0);
    assert.equal(store.state.touchedAt.get('tenant-a')?.getTime(), NOW.getTime());
  });
});
