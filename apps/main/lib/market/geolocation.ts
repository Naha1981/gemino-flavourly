/**
 * Gate #15 — competitor discovery: geocoding + nearby restaurant search.
 *
 * Framework-free by design (no Next.js imports): every network call takes an
 * injectable `fetchImpl` and every payload transform is an exported pure
 * function, so the parsing and distance maths are tested against fixtures
 * rather than against a live API.
 *
 * TWO Google endpoints, deliberately different ones:
 *
 *   1. Geocoding API (`maps.googleapis.com/maps/api/geocode/json`) turns the
 *      tenant's street address into a point to search around. It is still the
 *      canonical geocoder — the 2025 key change that killed the LEGACY Places
 *      *Details* endpoint (see lib/reputation/google-places-client.ts) does
 *      not apply to it.
 *   2. Places API (New) Nearby Search (`places.googleapis.com/v1/places:search-
 *      Nearby`) finds restaurants inside a circle around that point. The New
 *      API is used because it is the one a key provisioned today can call, and
 *      because it returns the place id, rating, price level, website and phone
 *      in a single request.
 *
 * Cost note: the default field mask stays on the Nearby Search Pro/Enterprise
 * fields. The Atmosphere fields (`servesBrunch`, `regularOpeningHours`, …) are
 * a separate, more expensive SKU, so they are OPT-IN via `includeMealFlags` /
 * `includeOpeningHours` rather than silently billed on every discovery run.
 */

/** metres per km, spelled out because the Places API wants metres. */
const METRES_PER_KM = 1000;

/** Gate contract: the market radius is 5km unless a tenant widens it. */
export const DEFAULT_RADIUS_KM = 5;

/** Nearby Search hard limit: "radius must be between 0.0 and 50000.0". */
export const MAX_RADIUS_KM = 50;

/** Nearby Search hard limit: maxResultCount is 1..20. */
export const MAX_RESULTS = 20;

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const SEARCH_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  formattedAddress: string | null;
  /** Google's own confidence label (ROOFTOP / RANGE_INTERPOLATED / …). */
  locationType: string | null;
}

/** One normalized open/close period from a place's regular opening hours. */
export interface OpeningPeriod {
  /** 0 = Sunday … 6 = Saturday (Google's own numbering, kept as-is). */
  day: number;
  /** "HH:MM" local, or null for a 24h opening. */
  open: string | null;
  /** "HH:MM" local, or null when the place does not close that day. */
  close: string | null;
}

export interface NearbyRestaurant {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Great-circle distance from the search origin, rounded to 0.1km. */
  distanceKm: number | null;
  googlePlaceId: string;
  websiteUrl: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** Google's 1-4 band (inexpensive … very expensive), or null if unknown. */
  priceLevel: number | null;
  primaryType: string | null;
  types: string[];
  /** Atmosphere flags, lower-cased: 'brunch', 'vegetarian_food', … */
  serves: string[];
  openingHours: OpeningPeriod[];
}

export interface GeolocationOptions {
  /** Overrides the environment key (tests inject a fake one). */
  apiKey?: string;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  languageCode?: string;
  regionCode?: string;
}

export interface NearbyOptions extends GeolocationOptions {
  /** Search radius in km. Values above 50 are clamped (API limit). */
  radiusKm?: number;
  /** 1..20. */
  maxResults?: number;
  /** Request the (pricier) serves* atmosphere flags. */
  includeMealFlags?: boolean;
  /** Request (pricier) regular opening hours. */
  includeOpeningHours?: boolean;
}

/** Environment lookup: an explicit key wins, then the documented vars. */
export function resolveGeocodingKey(explicit?: string): string {
  return (
    (typeof explicit === 'string' && explicit.trim()) ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_GEOCODING_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    ''
  );
}

export function resolvePlacesKey(explicit?: string): string {
  return (
    (typeof explicit === 'string' && explicit.trim()) ||
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    ''
  );
}

/**
 * Great-circle distance in km. Haversine rather than a flat-earth
 * approximation because a 5km market radius sits well inside the range where
 * the two disagree by tens of metres — and `distance_km` is shown to the user
 * as the headline number for every competitor.
 */
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const EARTH_RADIUS_KM = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/** Rounded to 0.1km — sub-metre precision would imply accuracy we do not have. */
export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

/**
 * Google reports price level as either a number (legacy) or an enum string
 * (`PRICE_LEVEL_MODERATE`). Both normalize to the 1-4 band; anything else is
 * null, because guessing a price band for a competitor is worse than saying
 * "unknown".
 */
export function parsePriceLevel(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  const fromString =
    typeof value === 'string'
      ? { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 }[
          value.trim().toUpperCase()
        ]
      : undefined;
  const level = Number.isFinite(numeric) ? numeric : fromString;
  if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 4) return null;
  return Math.round(level);
}

/** "1130" -> "11:30"; Google uses HHMM strings with no separator. */
export function parseHourString(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{1,4}$/.test(value.trim())) return null;
  const raw = value.trim().padStart(4, '0');
  const hours = Number(raw.slice(0, 2));
  const minutes = Number(raw.slice(2));
  if (hours > 23 || minutes > 59) return null;
  return `${raw.slice(0, 2)}:${raw.slice(2)}`;
}

/** Payload shape we read (everything optional — the API omits masked fields). */
interface ApiPlace {
  id?: unknown;
  displayName?: { text?: unknown } | null;
  formattedAddress?: unknown;
  location?: { latitude?: unknown; longitude?: unknown } | null;
  rating?: unknown;
  userRatingCount?: unknown;
  priceLevel?: unknown;
  primaryType?: unknown;
  types?: unknown;
  websiteUri?: unknown;
  nationalPhoneNumber?: unknown;
  regularOpeningHours?: { periods?: unknown } | null;
  [key: string]: unknown;
}

/** 'servesBrunch' -> 'brunch', 'servesVegetarianFood' -> 'vegetarian_food'. */
export function mealFlagName(field: string): string {
  return field
    .replace(/^serves/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/** Which `serves*` fields we ask for when the caller opts into the SKU. */
export const MEAL_FLAG_FIELDS = [
  'servesBreakfast',
  'servesBrunch',
  'servesLunch',
  'servesDinner',
  'servesDessert',
  'servesBeer',
  'servesWine',
  'servesVegetarianFood',
] as const;

/** Pure transform: Nearby Search payload -> normalized competitors. */
export function parseNearbyPlaces(
  payload: unknown,
  origin: { latitude: number; longitude: number }
): NearbyRestaurant[] {
  const places = (payload as { places?: unknown } | null)?.places;
  if (!Array.isArray(places)) return [];

  const parsed: NearbyRestaurant[] = [];
  for (const raw of places as ApiPlace[]) {
    const placeId = typeof raw.id === 'string' ? raw.id.trim() : '';
    const name = typeof raw.displayName?.text === 'string' ? raw.displayName.text.trim() : '';
    // No id means the row cannot be deduplicated on a re-run, and no name
    // means there is nothing to show — skip rather than store a ghost.
    if (!placeId || !name) continue;

    const latitude = typeof raw.location?.latitude === 'number' ? raw.location.latitude : null;
    const longitude = typeof raw.location?.longitude === 'number' ? raw.location.longitude : null;
    const distanceKm =
      latitude !== null && longitude !== null
        ? roundKm(haversineKm(origin, { latitude, longitude }))
        : null;

    const serves: string[] = [];
    for (const field of MEAL_FLAG_FIELDS) {
      if (raw[field] === true) serves.push(mealFlagName(field));
    }

    parsed.push({
      name,
      address: typeof raw.formattedAddress === 'string' ? raw.formattedAddress : null,
      latitude,
      longitude,
      distanceKm,
      googlePlaceId: placeId,
      websiteUrl: typeof raw.websiteUri === 'string' ? raw.websiteUri : null,
      phone: typeof raw.nationalPhoneNumber === 'string' ? raw.nationalPhoneNumber : null,
      rating: typeof raw.rating === 'number' && Number.isFinite(raw.rating) ? raw.rating : null,
      reviewCount:
        typeof raw.userRatingCount === 'number' && Number.isFinite(raw.userRatingCount)
          ? Math.max(0, Math.round(raw.userRatingCount))
          : null,
      priceLevel: parsePriceLevel(raw.priceLevel),
      primaryType: typeof raw.primaryType === 'string' ? raw.primaryType : null,
      types: Array.isArray(raw.types) ? (raw.types as unknown[]).filter((t): t is string => typeof t === 'string') : [],
      serves,
      openingHours: parseOpeningPeriods(raw.regularOpeningHours),
    });
  }

  // Nearest first, with unknown distances last — the dashboard lists them in
  // this order and the gate's whole point is proximity.
  return parsed.sort((a, b) => {
    if (a.distanceKm === null && b.distanceKm === null) return 0;
    if (a.distanceKm === null) return 1;
    if (b.distanceKm === null) return -1;
    return a.distanceKm - b.distanceKm;
  });
}

/** Pure transform: a place's regular opening hours -> day/open/close triples. */
export function parseOpeningPeriods(value: unknown): OpeningPeriod[] {
  const periods = (value as { periods?: unknown } | null)?.periods;
  if (!Array.isArray(periods)) return [];

  const parsed: OpeningPeriod[] = [];
  for (const period of periods as Array<{
    open?: { day?: unknown; hour?: unknown } | null;
    close?: { day?: unknown; hour?: unknown } | null;
  }>) {
    const day = typeof period.open?.day === 'number' ? period.open.day : null;
    if (day === null || day < 0 || day > 6) continue;
    parsed.push({
      day,
      open: parseHourString(period.open?.hour),
      close: parseHourString(period.close?.hour),
    });
  }
  return parsed.sort((a, b) => a.day - b.day);
}

/** Pure transform: a Geocoding response -> the first usable result. */
export function parseGeocodeResponse(payload: unknown): GeoCoordinates | null {
  const body = payload as { results?: unknown } | null;
  const results = body?.results;
  if (!Array.isArray(results) || results.length === 0) return null;

  // Google orders by confidence, so the first result with a location is the
  // best answer; results without geometry (a partial match) are skipped.
  for (const result of results as Array<{
    formatted_address?: unknown;
    geometry?: { location?: { lat?: unknown; lng?: unknown }; location_type?: unknown } | null;
  }>) {
    const lat = result.geometry?.location?.lat;
    const lng = result.geometry?.location?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    return {
      latitude: lat,
      longitude: lng,
      formattedAddress:
        typeof result.formatted_address === 'string' ? result.formatted_address : null,
      locationType:
        typeof result.geometry?.location_type === 'string' ? result.geometry.location_type : null,
    };
  }
  return null;
}

/** The field mask for one discovery run, built from what the caller asked for. */
export function nearbyFieldMask(options: NearbyOptions = {}): string {
  const fields = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.rating',
    'places.userRatingCount',
    'places.priceLevel',
    'places.primaryType',
    'places.types',
    'places.websiteUri',
    'places.nationalPhoneNumber',
  ];
  if (options.includeMealFlags) fields.push(...MEAL_FLAG_FIELDS.map((field) => `places.${field}`));
  if (options.includeOpeningHours) fields.push('places.regularOpeningHours');
  return fields.join(',');
}

/** Clamp + validate the search radius. Returns the radius actually used. */
export function clampRadiusKm(radiusKm: number | undefined): number {
  if (typeof radiusKm !== 'number' || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return DEFAULT_RADIUS_KM;
  }
  return Math.min(radiusKm, MAX_RADIUS_KM);
}

/**
 * Geocode a street address. Returns null when Google knows no such address
 * (status ZERO_RESULTS) and throws on transport/API errors, so a caller can
 * tell "we could not find that address" from "the call failed".
 */
export async function getCoordinates(
  address: string,
  options: GeolocationOptions = {}
): Promise<GeoCoordinates | null> {
  const trimmed = typeof address === 'string' ? address.trim() : '';
  if (!trimmed) throw new Error('An address is required to geocode');

  const apiKey = resolveGeocodingKey(options.apiKey);
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY is not set — competitor discovery cannot geocode');
  }

  const doFetch = options.fetchImpl ?? fetch;
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('address', trimmed);
  url.searchParams.set('key', apiKey);
  if (options.languageCode) url.searchParams.set('language', options.languageCode);
  if (options.regionCode) url.searchParams.set('region', options.regionCode);

  const res = await doFetch(new Request(url.toString(), { method: 'GET' }));
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Geocoding API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await res.json().catch(() => null)) as
    | { status?: unknown; error_message?: unknown; results?: unknown }
    | null;
  const status = typeof payload?.status === 'string' ? payload.status : '';
  if (status === 'ZERO_RESULTS') return null;
  if (status && status !== 'OK') {
    const detail = typeof payload?.error_message === 'string' ? ` (${payload.error_message})` : '';
    throw new Error(`Google Geocoding API rejected the address: ${status}${detail}`);
  }
  return parseGeocodeResponse(payload);
}

/**
 * Restaurants within `radiusKm` of a point, nearest first.
 *
 * Returns [] (not a throw) when the area simply has no matching places;
 * throws only on transport/API errors so the caller can distinguish "empty
 * market" from "broken integration".
 */
export async function findNearbyRestaurants(
  latitude: number,
  longitude: number,
  radiusKm: number = DEFAULT_RADIUS_KM,
  options: NearbyOptions = {}
): Promise<NearbyRestaurant[]> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Valid latitude and longitude are required');
  }

  const apiKey = resolvePlacesKey(options.apiKey);
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set — competitor discovery cannot run');
  }

  const radius = clampRadiusKm(radiusKm);
  if (typeof radiusKm === 'number' && radiusKm > MAX_RADIUS_KM) {
    console.warn(
      `[market] requested radius ${radiusKm}km exceeds the Places API limit — searching ${MAX_RADIUS_KM}km instead`
    );
  }

  const requested = options.maxResults;
  const maxResults = Math.min(
    MAX_RESULTS,
    Math.max(1, Math.round(typeof requested === 'number' && Number.isFinite(requested) ? requested : MAX_RESULTS))
  );

  const body = {
    locationRestriction: {
      circle: { center: { latitude, longitude }, radius: radius * METRES_PER_KM },
    },
    includedTypes: ['restaurant'],
    maxResultCount: maxResults,
    languageCode: options.languageCode ?? 'en',
    ...(options.regionCode ? { regionCode: options.regionCode } : {}),
  };

  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(
    new Request(SEARCH_NEARBY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': nearbyFieldMask(options),
      },
      body: JSON.stringify(body),
    })
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Places Nearby Search error ${res.status}: ${text.slice(0, 200)}`);
  }

  const payload = (await res.json().catch(() => null)) as { places?: unknown } | null;
  return parseNearbyPlaces(payload, { latitude, longitude });
}

export interface DiscoveryResult {
  origin: GeoCoordinates;
  /** The radius actually searched (clamped to the API limit). */
  radiusKm: number;
  restaurants: NearbyRestaurant[];
}

/**
 * The full discovery step behind the dashboard's "Discover Competitors"
 * button: geocode the tenant's address, then list every restaurant inside the
 * radius. Throws when the address cannot be geocoded, because there is
 * nothing left to search around.
 */
export async function discoverCompetitors(
  address: string,
  options: NearbyOptions = {}
): Promise<DiscoveryResult> {
  const origin = await getCoordinates(address, options);
  if (!origin) {
    throw new Error(`No coordinates found for "${address}" — check the address and try again`);
  }
  const radiusKm = clampRadiusKm(options.radiusKm);
  const restaurants = await findNearbyRestaurants(origin.latitude, origin.longitude, radiusKm, options);
  return { origin, radiusKm, restaurants };
}
