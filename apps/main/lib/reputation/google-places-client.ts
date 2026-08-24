import crypto from 'node:crypto';

/**
 * Gate #11 — Google Places API (New) client, framework-free.
 *
 * Why the Places API (New) (`places.googleapis.com/v1`) and not the legacy
 * `maps.googleapis.com/maps/api/place/details/json`:
 *
 *   1. The legacy Details API stopped issuing new keys for it in 2025 — a
 *      key provisioned today simply cannot call it.
 *   2. The legacy response has NO review id (only author_name/rating/text/
 *      time), so `google_reviews.review_id` — the upsert key that makes the
 *      daily fetch idempotent — would have to be a synthetic hash. The New
 *      API returns a real, stable `places/{place}/reviews/{id}` name.
 *
 * One wrinkle: the New API's reviews only carry a RELATIVE publish date
 * ("3 days ago"), not an absolute timestamp. `parseRelativeTime` converts
 * that into an approximate Date (rounded to the unit — a "2 months ago"
 * review is stamped exactly 2 months back). `time` is used for ordering and
 * display, never for eligibility decisions, so an approximation bounded by
 * the relative description's own granularity is honest.
 *
 * The fetch implementation is injectable so tests exercise the parsing and
 * classification logic against fixtures without network access.
 */

export type ReviewSentiment = 'positive' | 'neutral' | 'negative';

/** A single review, normalized from either API shape. */
export interface GooglePlaceReview {
  /** Stable Google review id (last path segment of the review's name). */
  reviewId: string;
  authorName: string;
  rating: number;
  text: string | null;
  /** Approximate publish time parsed from the relative description. */
  time: Date;
  sentiment: ReviewSentiment;
}

export interface PlaceRating {
  rating: number;
  reviewCount: number;
}

export interface GooglePlacesOptions {
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Reference "now" for relative-date parsing; injected so tests pin time. */
  now?: Date;
}

const PLACES_BASE = 'https://places.googleapis.com/v1/places';

/**
 * Rating-only sentiment classification, exactly as the gate specifies:
 *   rating >= 4 -> positive, rating <= 2 -> negative, else neutral.
 * Out-of-range ratings are rejected (null) rather than guessed: Google
 * ratings are 1..5 integers, and anything else means the payload was
 * malformed.
 */
export function classifySentiment(rating: number): ReviewSentiment | null {
  if (!Number.isFinite(rating) || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  if (rating >= 4) return 'positive';
  if (rating <= 2) return 'negative';
  return 'neutral';
}

/**
 * Parse a Places API relative publish description ("an hour ago",
 * "3 days ago", "2 months ago", "a year ago") into an approximate absolute
 * Date. Returns null for anything unrecognized — an unknown phrasing must
 * degrade to "unknown time" (caller falls back to fetch time), never to a
 * confidently wrong date.
 */
export function parseRelativeTime(description: string | null | undefined, now: Date): Date | null {
  if (typeof description !== 'string') return null;
  const match = description.trim().toLowerCase().match(/^(a|an|one|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
  if (!match) {
    // "a minute ago" / "just now" style zero-age phrasings.
    if (/^(a minute|a few seconds|just now)/.test(description.trim().toLowerCase())) {
      return new Date(now.getTime());
    }
    return null;
  }
  const quantity = match[1] === 'a' || match[1] === 'an' || match[1] === 'one' ? 1 : Number(match[1]);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const unitMs: Record<string, number> = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    // Months/years are calendar units; the month approximation (30d) and
    // year approximation (365d) match what the display will claim closely
    // enough for ordering. Exactness is impossible from the API payload.
    month: 2_592_000_000,
    year: 31_536_000_000,
  };
  const unit = unitMs[match[2]];
  if (!unit) return null;
  return new Date(now.getTime() - quantity * unit);
}

/** Places API (New) review payload (only the fields we read). */
interface PlacesApiReview {
  name?: unknown;
  rating?: unknown;
  relativePublishDateDescription?: unknown;
  text?: { text?: unknown } | null;
  originalText?: { text?: unknown } | null;
  authorAttribution?: { displayName?: unknown } | null;
}

/**
 * Pure payload -> normalized reviews transform, so tests can cover every
 * branch (missing text, missing author, unparseable date, bad rating)
 * without a network.
 */
export function parsePlaceReviews(
  payload: unknown,
  now: Date,
  fallbackTime?: Date
): GooglePlaceReview[] {
  const reviews = (payload as { reviews?: unknown } | null)?.reviews;
  if (!Array.isArray(reviews)) return [];

  const fallback = fallbackTime ?? now;
  const parsed: GooglePlaceReview[] = [];
  for (const raw of reviews as PlacesApiReview[]) {
    const name = typeof raw.name === 'string' ? raw.name : '';
    const reviewId = name.split('/').pop() ?? '';
    if (!reviewId) continue; // no stable id -> cannot upsert safely

    const rating = typeof raw.rating === 'number' ? raw.rating : Number.NaN;
    const sentiment = classifySentiment(rating);
    if (!sentiment) continue; // malformed rating -> skip the row entirely

    const author =
      typeof raw.authorAttribution?.displayName === 'string' && raw.authorAttribution.displayName.trim()
        ? raw.authorAttribution.displayName.trim()
        : 'Google user';

    const text =
      typeof raw.text?.text === 'string' && raw.text.text.trim()
        ? raw.text.text.trim()
        : typeof raw.originalText?.text === 'string' && raw.originalText.text.trim()
          ? raw.originalText.text.trim()
          : null;

    const relativeDescription =
      typeof raw.relativePublishDateDescription === 'string' ? raw.relativePublishDateDescription : null;
    const time = parseRelativeTime(relativeDescription, now) ?? fallback;

    parsed.push({ reviewId, authorName: author, rating, text, time, sentiment });
  }
  return parsed;
}

/** Build the authorized request for a place's reviews + aggregate rating. */
function placesRequest(placeId: string, apiKey: string): Request {
  return new Request(`${PLACES_BASE}/${encodeURIComponent(placeId)}?languageCode=en`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,rating,user_ratings_total,reviews',
    },
  });
}

/**
 * Fetch a place's reviews. Returns [] (not a throw) when the place simply
 * has no reviews yet; throws only on transport/API errors so the cron can
 * count a real failure differently from "nothing new".
 */
export async function fetchReviews(
  placeId: string,
  apiKey: string,
  options: GooglePlacesOptions = {}
): Promise<GooglePlaceReview[]> {
  const now = options.now ?? new Date();
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(placesRequest(placeId, apiKey));

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Places API error ${res.status} for place ${placeId}: ${body.slice(0, 200)}`);
  }

  const payload = (await res.json().catch(() => null)) as
    | { reviews?: unknown; error?: unknown }
    | null;
  if (payload?.error) {
    throw new Error(`Google Places API rejected place ${placeId}`);
  }
  return parsePlaceReviews(payload, now);
}

/**
 * Fetch a place's aggregate rating + review count (Gate #14 competitor
 * monitoring). Returns null when the API succeeds but carries no rating
 * (e.g. a brand-new listing with zero reviews) — 0 stars is a *different*
 * signal from "no rating yet" and must not be conflated.
 */
export async function fetchPlaceRating(
  placeId: string,
  apiKey: string,
  options: GooglePlacesOptions = {}
): Promise<PlaceRating | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(placesRequest(placeId, apiKey));

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Places API error ${res.status} for place ${placeId}: ${body.slice(0, 200)}`);
  }

  const payload = (await res.json().catch(() => null)) as
    | { rating?: unknown; user_ratings_total?: unknown }
    | null;
  const rating = typeof payload?.rating === 'number' ? payload.rating : Number.NaN;
  if (!Number.isFinite(rating)) return null;
  const reviewCount =
    typeof payload?.user_ratings_total === 'number' ? Math.max(0, Math.round(payload.user_ratings_total)) : 0;
  return { rating, reviewCount };
}
