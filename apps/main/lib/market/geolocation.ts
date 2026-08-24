/**
 * Gate #15 — geolocation + nearby-restaurant discovery, framework-free.
 *
 * Two Google endpoints, both with an injectable fetch so tests exercise
 * parsing against fixtures:
 *
 *   1. Geocoding API — address -> { latitude, longitude }
 *   2. Places API (New) `places:searchNearby` — restaurants within a
 *      radius, with the fields discovery needs (name, address, place id,
 *      rating, price level, website, phone, location).
 *
 * The Places API (New) is used for the same reason as the review client
 * (lib/reputation/google-places-client.ts): the legacy endpoints stopped
 * issuing new keys in 2025.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** A nearby restaurant, normalized. rating/priceLevel may be absent. */
export interface NearbyRestaurant {
  placeId: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  /** Google price level 0..4 (as the API's integer enum). */
  priceLevel: number | null;
  websiteUrl: string | null;
  phone: string | null;
}

export interface GeolocationOptions {
  fetchImpl?: typeof fetch;
}

const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const PLACES_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';

/** Platform Places key (discovery is tenant-initiated but platform-paid). */
export function placesApiKey(): string {
  return process.env.GOOGLE_PLACES_API_KEY || '';
}

/**
 * Great-circle distance in kilometres (haversine). Used for distance_km
 * even though searchNearby ranks by prominence — the dashboard promises
 * "within 5km", so the number must be a real distance, not a rank.
 */
export function haversineKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Address -> coordinates. Null when the address cannot be resolved. */
export async function getCoordinates(
  address: string,
  apiKey: string,
  options: GeolocationOptions = {}
): Promise<Coordinates | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = `${GEOCODING_URL}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`;
  const res = await doFetch(url);

  if (!res.ok) {
    throw new Error(`Geocoding API error ${res.status}`);
  }
  const payload = (await res.json().catch(() => null)) as
    | { status?: string; results?: Array<{ geometry?: { location?: { lat?: unknown; lng?: unknown } } }> }
    | null;

  const location = payload?.results?.[0]?.geometry?.location;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

/** "PRICE_LEVEL_MODERATE" -> 2; unknown shapes -> null (never a guess). */
export function parsePriceLevel(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw.startsWith('PRICE_LEVEL_')) return null;
  const suffix = raw.slice('PRICE_LEVEL_'.length);
  const table: Record<string, number> = {
    FREE: 0,
    INEXPENSIVE: 1,
    MODERATE: 2,
    EXPENSIVE: 3,
    VERY_EXPENSIVE: 4,
  };
  const value = table[suffix];
  return value === undefined ? null : value;
}

function parseLocation(raw: unknown): { latitude: number | null; longitude: number | null } {
  const location = raw as { latitude?: unknown; longitude?: unknown } | null | undefined;
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  return {
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
  };
}

/** Pure payload -> normalized list, so parsing is testable without network. */
export function parseNearbyResults(payload: unknown): NearbyRestaurant[] {
  const places = (payload as { places?: unknown } | null)?.places;
  if (!Array.isArray(places)) return [];

  const parsed: NearbyRestaurant[] = [];
  for (const raw of places as Array<Record<string, unknown>>) {
    const placeId = typeof raw.id === 'string' ? raw.id : '';
    const name =
      typeof (raw.displayName as { text?: unknown } | undefined)?.text === 'string'
        ? ((raw.displayName as { text: string }).text).trim()
        : '';
    if (!placeId || !name) continue;

    const location = parseLocation(raw.location);
    parsed.push({
      placeId,
      name,
      address: typeof raw.formattedAddress === 'string' ? raw.formattedAddress : null,
      latitude: location.latitude,
      longitude: location.longitude,
      rating: typeof raw.rating === 'number' ? raw.rating : null,
      priceLevel: parsePriceLevel(raw.priceLevel),
      websiteUrl: typeof raw.websiteUri === 'string' ? raw.websiteUri : null,
      phone: typeof raw.nationalPhoneNumber === 'string' ? raw.nationalPhoneNumber : null,
    });
  }
  return parsed;
}

/**
 * Restaurants within `radiusKm` of the point (Google caps the radius at
 * 50,000 m; values beyond are clamped, not rejected — the caller asked for
 * "as wide as the API allows", not for an error).
 */
export async function findNearbyRestaurants(
  origin: Coordinates,
  radiusKm: number,
  apiKey: string,
  options: GeolocationOptions = {}
): Promise<NearbyRestaurant[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const radiusMeters = Math.min(50_000, Math.max(1, Math.round(radiusKm * 1000)));

  const res = await doFetch(PLACES_NEARBY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.priceLevel,places.websiteUri,places.nationalPhoneNumber',
    },
    body: JSON.stringify({
      includedTypes: ['restaurant'],
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: { latitude: origin.latitude, longitude: origin.longitude },
          radius: radiusMeters,
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Places searchNearby error ${res.status}: ${body.slice(0, 200)}`);
  }
  const payload = await res.json().catch(() => null);
  return parseNearbyResults(payload);
}

export const DEFAULT_DISCOVERY_RADIUS_KM = 5;
