import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySentiment,
  parseRelativeTime,
  parsePlaceReviews,
  fetchReviews,
  fetchPlaceRating,
} from './google-places-client.ts';

const NOW = new Date('2026-08-20T12:00:00Z');

describe('classifySentiment (Gate #11 contract)', () => {
  test('rating >= 4 is positive, <= 2 is negative, 3 is neutral', () => {
    assert.equal(classifySentiment(5), 'positive');
    assert.equal(classifySentiment(4), 'positive');
    assert.equal(classifySentiment(3), 'neutral');
    assert.equal(classifySentiment(2), 'negative');
    assert.equal(classifySentiment(1), 'negative');
  });

  test('out-of-range or non-integer ratings are rejected, not guessed', () => {
    assert.equal(classifySentiment(0), null);
    assert.equal(classifySentiment(6), null);
    assert.equal(classifySentiment(4.5), null);
    assert.equal(classifySentiment(Number.NaN), null);
    assert.equal(classifySentiment(-1), null);
  });
});

describe('parseRelativeTime', () => {
  test('converts each unit family to an approximate absolute date', () => {
    assert.equal(parseRelativeTime('an hour ago', NOW)!.getTime(), NOW.getTime() - 3_600_000);
    assert.equal(parseRelativeTime('3 days ago', NOW)!.getTime(), NOW.getTime() - 3 * 86_400_000);
    assert.equal(parseRelativeTime('2 weeks ago', NOW)!.getTime(), NOW.getTime() - 2 * 604_800_000);
    assert.equal(parseRelativeTime('a month ago', NOW)!.getTime(), NOW.getTime() - 2_592_000_000);
    assert.equal(parseRelativeTime('a year ago', NOW)!.getTime(), NOW.getTime() - 31_536_000_000);
  });

  test('near-zero-age phrasings resolve to (almost) now', () => {
    assert.equal(parseRelativeTime('a minute ago', NOW)!.getTime(), NOW.getTime() - 60_000);
    assert.equal(parseRelativeTime('a few seconds ago', NOW)!.getTime(), NOW.getTime());
    assert.equal(parseRelativeTime('just now', NOW)!.getTime(), NOW.getTime());
  });

  test('unrecognized phrasing returns null (never a confident wrong date)', () => {
    assert.equal(parseRelativeTime('yesterday sometime', NOW), null);
    assert.equal(parseRelativeTime('', NOW), null);
    assert.equal(parseRelativeTime(null, NOW), null);
    assert.equal(parseRelativeTime(undefined, NOW), null);
    assert.equal(parseRelativeTime('0 days ago', NOW), null);
  });
});

describe('parsePlaceReviews', () => {
  const payload = {
    id: 'place-1',
    rating: 4.5,
    user_ratings_total: 127,
    reviews: [
      {
        name: 'places/place-1/reviews/review-aaa',
        rating: 5,
        relativePublishDateDescription: '2 days ago',
        text: { text: 'Best ribs in Benoni! ' },
        authorAttribution: { displayName: 'Thabo M.' },
      },
      {
        name: 'places/place-1/reviews/review-bbb',
        rating: 3,
        relativePublishDateDescription: 'a month ago',
        originalText: { text: 'Food fine, service slow' },
      },
      {
        name: 'places/place-1/reviews/review-ccc',
        rating: 1,
        text: { text: 'Cold food, never again' },
        authorAttribution: { displayName: '  ' },
      },
      // Malformed rows are skipped, not crashed on:
      { rating: 4 }, // no name -> no stable id
      { name: 'places/place-1/reviews/review-ddd', rating: 9 }, // bad rating
    ],
  };

  test('normalizes author, text (incl. originalText fallback), rating, sentiment', () => {
    const reviews = parsePlaceReviews(payload, NOW);
    assert.equal(reviews.length, 3);

    const [aaa, bbb, ccc] = reviews;
    assert.equal(aaa.reviewId, 'review-aaa');
    assert.equal(aaa.authorName, 'Thabo M.');
    assert.equal(aaa.rating, 5);
    assert.equal(aaa.text, 'Best ribs in Benoni!');
    assert.equal(aaa.sentiment, 'positive');
    assert.equal(aaa.time.getTime(), NOW.getTime() - 2 * 86_400_000);

    assert.equal(bbb.text, 'Food fine, service slow');
    assert.equal(bbb.sentiment, 'neutral');

    assert.equal(ccc.authorName, 'Google user'); // blank displayName -> safe default
    assert.equal(ccc.sentiment, 'negative');
  });

  test('unparseable relative date falls back to the provided fallback time', () => {
    const fallback = new Date('2026-08-19T00:00:00Z');
    const reviews = parsePlaceReviews(
      { reviews: [{ name: 'p/r/x', rating: 4, text: { text: 'lovely' } }] },
      NOW,
      fallback
    );
    assert.equal(reviews[0].time.getTime(), fallback.getTime());
  });

  test('empty or review-less payloads return []', () => {
    assert.deepEqual(parsePlaceReviews({}, NOW), []);
    assert.deepEqual(parsePlaceReviews({ reviews: [] }, NOW), []);
    assert.deepEqual(parsePlaceReviews(null, NOW), []);
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchReviews (injectable transport)', () => {
  test('happy path: returns normalized reviews and sends the field mask + key', async () => {
    let seen: Request | null = null;
    const fetchImpl = (async (req: Request) => {
      seen = req;
      return jsonResponse({
        reviews: [
          {
            name: 'places/p1/reviews/r1',
            rating: 4,
            relativePublishDateDescription: '5 days ago',
            text: { text: 'Great vibe' },
            authorAttribution: { displayName: 'Ana' },
          },
        ],
      });
    }) as unknown as typeof fetch;

    const reviews = await fetchReviews('p1', 'test-key', { fetchImpl, now: NOW });
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].reviewId, 'r1');
    assert.equal(reviews[0].sentiment, 'positive');
    assert.ok((seen as Request | null)!.url.includes('places/p1'));
    assert.equal((seen as Request | null)!.headers.get('X-Goog-Api-Key'), 'test-key');
    assert.match((seen as Request | null)!.headers.get('X-Goog-FieldMask')!, /reviews/);
  });

  test('API error surfaces as a throw the cron can count', async () => {
    const fetchImpl = (async () => jsonResponse({ error: { message: 'bad key' } }, 403)) as unknown as typeof fetch;
    await assert.rejects(fetchReviews('p1', 'bad', { fetchImpl }), /403/);
  });

  test('no reviews yet is an empty array, not an error', async () => {
    const fetchImpl = (async () => jsonResponse({})) as unknown as typeof fetch;
    assert.deepEqual(await fetchReviews('p1', 'k', { fetchImpl, now: NOW }), []);
  });
});

describe('fetchPlaceRating (Gate #14)', () => {
  test('returns rating + review count', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ rating: 4.2, user_ratings_total: 87 })) as unknown as typeof fetch;
    assert.deepEqual(await fetchPlaceRating('p1', 'k', { fetchImpl }), { rating: 4.2, reviewCount: 87 });
  });

  test('place with no rating yet returns null (distinct from 0)', async () => {
    const fetchImpl = (async () => jsonResponse({ rating: 1.5, user_ratings_total: 0 })) as unknown as typeof fetch;
    // A real rating exists even with 0 reviews — return it.
    assert.deepEqual(await fetchPlaceRating('p1', 'k', { fetchImpl }), { rating: 1.5, reviewCount: 0 });

    const noRating = (async () => jsonResponse({})) as unknown as typeof fetch;
    assert.equal(await fetchPlaceRating('p1', 'k', { fetchImpl: noRating }), null);
  });

  test('API error surfaces as a throw', async () => {
    const fetchImpl = (async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    await assert.rejects(fetchPlaceRating('p1', 'k', { fetchImpl }), /500/);
  });
});
