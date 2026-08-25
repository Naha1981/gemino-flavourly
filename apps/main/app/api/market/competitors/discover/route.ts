import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  createCompetitor,
  knownPlaceIds,
  saveTenantLocation,
} from '@/lib/market/competitor-store';
import { discoverCompetitors, clampRadiusKm } from '@/lib/market/geolocation';
import { serializeCompetitor } from '@/lib/market/serialization';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// One geocode call plus one Nearby Search: two round trips to Google, then a
// handful of inserts. Comfortably inside the default limit.
export const maxDuration = 60;

/** Ceiling on rows created by a single discovery run. */
const MAX_ADDED_PER_RUN = 20;

/**
 * Gate #15 — "Discover Competitors".
 *
 * Geocodes the tenant's address (the one saved in Settings, or one supplied
 * in the request) and stores every restaurant Google returns inside the
 * radius, nearest first.
 *
 * Skips, deliberately:
 *   - places already tracked (a re-run must not duplicate the list), and
 *   - the tenant's OWN Google place, from google_places_config. Tracking
 *     yourself as your own competitor is a bug, not a feature.
 *
 * The geocoded origin is written back to the tenant row, so the next run is
 * one click and one geocode call instead of a re-typed address.
 */
export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { address?: unknown; radius_km?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requestedAddress = typeof body.address === 'string' ? body.address.trim() : '';
  const address = requestedAddress || tenant.address || '';
  if (!address) {
    return NextResponse.json(
      { error: 'No address on file. Add your restaurant address in Settings, or pass "address" in the request body.' },
      { status: 400 }
    );
  }

  const radiusKm = clampRadiusKm(typeof body.radius_km === 'number' ? body.radius_km : undefined);

  let result;
  try {
    // includeMealFlags: the Atmosphere SKU costs more per call, but it is the
    // only direct source of "does this place serve brunch/vegetarian food",
    // which is what market opportunity detection (#17) is built on.
    result = await discoverCompetitors(address, { radiusKm, includeMealFlags: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Discovery failed';
    const status = /No coordinates found/.test(message) ? 422 : 502;
    console.error('[MarketDiscovery] discovery failed', message);
    return NextResponse.json({ error: message }, { status });
  }

  await saveTenantLocation(tenant.id, {
    address: result.origin.formattedAddress ?? address,
    latitude: result.origin.latitude,
    longitude: result.origin.longitude,
  });

  const known = await knownPlaceIds(tenant.id);
  const added: ReturnType<typeof serializeCompetitor>[] = [];
  let skippedExisting = 0;

  for (const restaurant of result.restaurants) {
    if (known.has(restaurant.googlePlaceId)) {
      skippedExisting += 1;
      continue;
    }
    if (added.length >= MAX_ADDED_PER_RUN) break;

    const row = await createCompetitor(tenant.id, {
      name: restaurant.name,
      address: restaurant.address,
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
      distanceKm: restaurant.distanceKm,
      googlePlaceId: restaurant.googlePlaceId,
      websiteUrl: restaurant.websiteUrl,
      phone: restaurant.phone,
      placeData: {
        types: restaurant.types,
        serves: restaurant.serves,
        priceLevel: restaurant.priceLevel,
        rating: restaurant.rating,
      },
    });
    known.add(restaurant.googlePlaceId);
    added.push(serializeCompetitor(row));
  }

  return NextResponse.json({
    ok: true,
    origin: {
      address: result.origin.formattedAddress ?? address,
      latitude: result.origin.latitude,
      longitude: result.origin.longitude,
      location_type: result.origin.locationType,
    },
    radius_km: result.radiusKm,
    found: result.restaurants.length,
    added: added.length,
    skipped_existing: skippedExisting,
    competitors: added,
  });
}
