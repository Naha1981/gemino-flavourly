import {
  DEFAULT_DISCOVERY_RADIUS_KM,
  findNearbyRestaurants,
  getCoordinates,
  haversineKm,
  type Coordinates,
  type NearbyRestaurant,
} from './geolocation.ts';

/**
 * Gate #15 — competitor discovery runner, framework-free.
 *
 * Resolve the tenant's origin (their configured Google place when possible,
 * otherwise a geocoded address), search for restaurants within the radius,
 * annotate each with a real great-circle distance, mark the tenant's own
 * place as is_self, and upsert everything idempotently.
 *
 * The store seam makes the whole flow testable end-to-end with an in-memory
 * adapter; the Drizzle wiring lives in competitor-store.ts + the route.
 */

export interface DiscoveryStore {
  /** The tenant's own Google place id, or null when unconfigured. */
  getTenantPlaceId(tenantId: string): Promise<string | null>;
  /** The tenant's address for geocoding (tenant row). */
  getTenantAddress(tenantId: string): Promise<string | null>;
  upsertCompetitor(
    tenantId: string,
    input: {
      name: string;
      googlePlaceId: string;
      address?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      distanceKm?: number | null;
      rating?: number | null;
      priceLevel?: number | null;
      websiteUrl?: string | null;
      phone?: string | null;
      isSelf?: boolean;
    }
  ): Promise<{ inserted: boolean }>;
}

export interface DiscoveryOptions {
  radiusKm?: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Injectable seams for tests. */
  geocode?: typeof getCoordinates;
  findNearby?: typeof findNearbyRestaurants;
}

export interface DiscoveryResult {
  origin: Coordinates | null;
  originSource: 'place' | 'geocoded' | 'none';
  found: number;
  saved: number;
  newCompetitors: number;
  updated: number;
  self: boolean;
  competitors: Array<{
    placeId: string;
    name: string;
    distanceKm: number | null;
    rating: number | null;
    priceLevel: number | null;
    websiteUrl: string | null;
    isSelf: boolean;
    inserted: boolean;
  }>;
  skipped: { noApiKey: boolean; noOrigin: boolean };
}

/**
 * The search origin: the tenant's street address, geocoded. (The tenant's
 * own place row only exists AFTER a first discovery, so the address is the
 * stable pre-discovery anchor.)
 */
async function resolveOrigin(
  store: DiscoveryStore,
  tenantId: string,
  apiKey: string,
  geocode: typeof getCoordinates,
  fetchImpl: typeof fetch | undefined
): Promise<{ origin: Coordinates | null; source: DiscoveryResult['originSource'] }> {
  const address = await store.getTenantAddress(tenantId).catch(() => null);
  if (!address) return { origin: null, source: 'none' };
  const coords = await geocode(address, apiKey, { fetchImpl }).catch(() => null);
  if (!coords) return { origin: null, source: 'none' };
  return { origin: coords, source: 'geocoded' };
}

export async function runDiscovery(
  store: DiscoveryStore,
  tenantId: string,
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  const radiusKm = options.radiusKm ?? DEFAULT_DISCOVERY_RADIUS_KM;
  const apiKey = options.apiKey ?? process.env.GOOGLE_PLACES_API_KEY ?? '';
  const fetchImpl = options.fetchImpl;
  const geocode = options.geocode ?? getCoordinates;
  const findNearby = options.findNearby ?? findNearbyRestaurants;

  const result: DiscoveryResult = {
    origin: null,
    originSource: 'none',
    found: 0,
    saved: 0,
    newCompetitors: 0,
    updated: 0,
    self: false,
    competitors: [],
    skipped: { noApiKey: false, noOrigin: false },
  };

  if (!apiKey) {
    console.error('[Discovery] GOOGLE_PLACES_API_KEY is not set — cannot discover competitors');
    result.skipped.noApiKey = true;
    return result;
  }

  const { origin, source } = await resolveOrigin(store, tenantId, apiKey, geocode, fetchImpl);
  if (!origin) {
    result.skipped.noOrigin = true;
    return result;
  }
  result.origin = origin;
  result.originSource = source;

  const nearby: NearbyRestaurant[] = await findNearby(origin, radiusKm, apiKey, { fetchImpl });
  result.found = nearby.length;

  const ownPlaceId = await store.getTenantPlaceId(tenantId).catch(() => null);

  for (const place of nearby) {
    const distanceKm =
      place.latitude != null && place.longitude != null ? haversineKm(origin, { latitude: place.latitude, longitude: place.longitude }) : null;
    const isSelf = ownPlaceId !== null && place.placeId === ownPlaceId;
    if (isSelf) result.self = true;

    try {
      const { inserted } = await store.upsertCompetitor(tenantId, {
        name: place.name,
        googlePlaceId: place.placeId,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        distanceKm,
        rating: place.rating,
        priceLevel: place.priceLevel,
        websiteUrl: place.websiteUrl,
        phone: place.phone,
        isSelf,
      });
      result.saved += 1;
      if (inserted) result.newCompetitors += 1;
      else result.updated += 1;
      result.competitors.push({
        placeId: place.placeId,
        name: place.name,
        distanceKm,
        rating: place.rating,
        priceLevel: place.priceLevel,
        websiteUrl: place.websiteUrl,
        isSelf,
        inserted,
      });
    } catch (err) {
      console.error(`[Discovery] Failed to upsert place ${place.placeId}`, err);
    }
  }

  return result;
}
