import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { runDiscovery } from '@/lib/market/discovery';
import { discoveryStore } from '../route';

export const dynamic = 'force-dynamic';
// Discovery makes two Google API calls (geocode + nearby search) and then
// upserts up to ~20 rows — comfortably inside 60s.
export const maxDuration = 60;

/**
 * Gate #15 — "Discover Competitors": geocode the tenant's address, search
 * for restaurants within 5km, and upsert them (the tenant's own place is
 * flagged is_self). Idempotent: re-running refreshes discovery metadata
 * instead of duplicating rows.
 */
export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let radiusKm = 5;
  try {
    const body = (await req.json().catch(() => ({}))) as { radius_km?: unknown };
    const parsed = Number(body?.radius_km);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 50) radiusKm = parsed;
  } catch {
    // no/invalid body -> default 5km
  }

  const result = await runDiscovery(discoveryStore, tenant.id, { radiusKm });

  if (result.skipped.noApiKey) {
    return NextResponse.json(
      { error: 'Competitor discovery is not configured (GOOGLE_PLACES_API_KEY missing on the platform)' },
      { status: 503 }
    );
  }
  if (result.skipped.noOrigin) {
    return NextResponse.json(
      { error: 'Cannot resolve your restaurant location — set your Google Place ID in Settings first' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    origin: result.origin,
    radius_km: radiusKm,
    found: result.found,
    saved: result.saved,
    new_competitors: result.newCompetitors,
    updated: result.updated,
    competitors: result.competitors,
  });
}
