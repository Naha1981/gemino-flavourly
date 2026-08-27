/**
 * Brand Intelligence Engine — Google Places enrichment.
 *
 * Given a restaurant name + city, resolves the Google place and returns its
 * rating, review count, first few reviews, opening hours and address — the
 * real, customer-facing data that makes a demo tenant look live. Framework
 * free: the parsing is exported pure (`parseSearchResponse` / `parseDetailsResponse`)
 * so it is testable without a network, and `fetchGooglePlacesData` is the
 * injectable I/O wrapper used by the demo-tenant builder.
 *
 * Uses the Google Places API (New) — same choice as the Reputation engine
 * (see lib/reputation/google-places-client.ts) — so a single key works for
 * both hot paths.
 */

export interface PlacesReview {
  authorName: string;
  rating: number;
  text: string | null;
  relativeTime: string | null;
}

export interface PlacesResult {
  placeId: string;
  displayName: string | null;
  rating: number | null;
  reviewCount: number | null;
  address: string | null;
  websiteUri: string | null;
  /** Opening hours grouped by weekday (0=Sunday, 7 = Iso weekday order). */
  opens: string | null;
  /** Place photo (authorisation-free URL if the API provides one). */
  photoUrl: string | null;
  reviews: PlacesReview[];
}

export interface GooglePlacesData {
  placeId: string;
  name: string | null;
  rating: number | null;
  reviewCount: number | null;
  address: string | null;
  hoursJson: unknown;
  reviews: PlacesReview[];
}

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';

export function classifyPlaceRating(rating: number): 'positive' | 'neutral' | 'negative' {
  if (rating >= 4) return 'positive';
  if (rating <= 2) return 'negative';
  return 'neutral';
}

/** Parse the Text Search (New) response into a compact place summary. */
export function parseSearchResponse(data: unknown): PlacesResult | null {
  const places = (data as any)?.places;
  if (!Array.isArray(places) || places.length === 0) return null;
  const p = places[0];

  const reviewsRaw = Array.isArray(p?.reviews) ? p.reviews : [];
  const reviews: PlacesReview[] = reviewsRaw.map((r: any) => ({
    authorName: r?.authorAttribution?.displayName ?? r?.authorName ?? 'Google User',
    rating: Number.isFinite(Number(r?.rating)) ? Number(r?.rating) : 0,
    text: r?.text?.text ?? r?.text ?? null,
    relativeTime: r?.relativePublishTimeDescription ?? null,
  }));

  return {
    placeId: p?.id ?? '',
    displayName: p?.displayName?.text ?? null,
    rating: Number.isFinite(Number(p?.rating)) ? Number(p?.rating) : null,
    reviewCount: Number.isFinite(Number(p?.userRatingCount)) ? Number(p?.userRatingCount) : null,
    address: p?.formattedAddress ?? null,
    websiteUri: p?.websiteUri ?? null,
    opens: p?.regularOpeningHours?.weekdayDescriptions?.[0] ?? null,
    photoUrl: p?.photos?.[0]?.name ?? null,
    reviews: reviews.slice(0, 5),
  };
}

/** Combine search + one detail lookup into the shape the seeder consumes. */
export function mergePlaceData(summary: PlacesResult | null, detail: unknown): GooglePlacesData {
  const d = parseDetailsResponse(detail);
  return {
    placeId: d?.placeId ?? summary?.placeId ?? '',
    name: d?.name ?? summary?.displayName ?? null,
    rating: d?.rating ?? summary?.rating ?? null,
    reviewCount: d?.reviewCount ?? summary?.reviewCount ?? null,
    address: d?.address ?? summary?.address ?? null,
    hoursJson: d?.hoursJson ?? summary?.opens ?? null,
    reviews: d && d.reviews.length > 0 ? d.reviews : summary?.reviews ?? [],
  };
}

/** Parse a Place Details (New) response into the fields we seed. */
export function parseDetailsResponse(data: unknown): GooglePlacesData | null {
  const d = (data as any) ?? {};
  if (!d?.id && !d?.name) return null;
  const reviewsRaw = Array.isArray(d?.reviews) ? d.reviews : [];
  const reviews: PlacesReview[] = reviewsRaw.slice(0, 5).map((r: any) => ({
    authorName: r?.authorAttribution?.displayName ?? r?.authorName ?? 'Google User',
    rating: Number.isFinite(Number(r?.rating)) ? Number(r?.rating) : 0,
    text: r?.text?.text ?? r?.text ?? null,
    relativeTime: r?.relativePublishTimeDescription ?? null,
  }));

  const weekday = d?.regularOpeningHours?.weekdayDescriptions ?? null;
  return {
    placeId: d?.id ?? (d?.name as string)?.split('/').pop() ?? '',
    name: d?.displayName?.text ?? null,
    rating: Number.isFinite(Number(d?.rating)) ? Number(d?.rating) : null,
    reviewCount: Number.isFinite(Number(d?.userRatingCount)) ? Number(d?.userRatingCount) : null,
    address: d?.formattedAddress ?? null,
    hoursJson: weekday,
    reviews,
  };
}

export interface GooglePlacesOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Run the whole enrichment: brief Text Search for place id + review snapshot,
 * then a Details call for hours/address. Never throws — a missing key, a 4xx,
 * or a network failure returns an empty result so the demo builder can still
 * fall back to generated data.
 */
export async function fetchGooglePlacesData(
  restaurantName: string,
  city: string,
  options: GooglePlacesOptions = {}
): Promise<GooglePlacesData> {
  const apiKey = options.apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return emptyPlace();
  const fetchImpl = options.fetchImpl ?? fetch;
  const query = city && city.trim() ? `${restaurantName} ${city}` : restaurantName;

  try {
    // S1 — every enrichment source gets a hard 10s timeout so a hung Places
    // call can never stall the inline build.
    const searchRes = await fetchImpl(SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.regularOpeningHours,places.photos,places.reviews',
      },
      body: JSON.stringify({ textQuery: query, pageSize: 1 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!searchRes.ok) return emptyPlace();
    const searchData = await searchRes.json();
    const summary = parseSearchResponse(searchData);
    if (!summary?.placeId) return emptyPlace();

    const detailRes = await fetchImpl(`${DETAILS_URL}/${summary.placeId}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'id,displayName,formattedAddress,rating,userRatingCount,regularOpeningHours.weekdayDescriptions,reviews,reviews.authorAttribution,reviews.rating,reviews.text,reviews.relativePublishTimeDescription',
      },
      signal: AbortSignal.timeout(10_000),
    });
    const detail = detailRes.ok ? await detailRes.json() : null;
    return mergePlaceData(summary, detail);
  } catch {
    return emptyPlace();
  }
}

function emptyPlace(): GooglePlacesData {
  return {
    placeId: '',
    name: null,
    rating: null,
    reviewCount: null,
    address: null,
    hoursJson: null,
    reviews: [],
  };
}
