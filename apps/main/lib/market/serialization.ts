import type { PlaceData } from './competitor-store.ts';

/**
 * Gate #15 — the wire shape for a competitor row.
 *
 * It lives in lib/ rather than in a route file on purpose: Next.js app-router
 * route modules may only export handlers and route-segment config, so a
 * shared helper exported from app/api/.../route.ts fails the build's route
 * type check. It is also shared by two routes (list + discover), so a single
 * definition keeps their payloads identical.
 */

export interface CompetitorRowShape {
  id: string;
  name: string;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  distanceKm: string | null;
  googlePlaceId: string | null;
  websiteUrl: string | null;
  phone: string | null;
  placeData: unknown;
  currentRating: string;
  reviewCount: number;
  lastCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** numeric() columns arrive as strings; the API contract is numbers or null. */
function numberOf(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function serializeCompetitor(row: CompetitorRowShape) {
  const place = (row.placeData ?? {}) as PlaceData;
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    latitude: numberOf(row.latitude),
    longitude: numberOf(row.longitude),
    distance_km: numberOf(row.distanceKm),
    google_place_id: row.googlePlaceId,
    website_url: row.websiteUrl,
    phone: row.phone,
    place_types: place.types ?? [],
    serves: place.serves ?? [],
    price_level: place.priceLevel ?? null,
    current_rating: Number(row.currentRating),
    review_count: row.reviewCount,
    last_rating_check_at: row.lastCheckAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
