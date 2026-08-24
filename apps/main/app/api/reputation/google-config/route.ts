import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getPlaceConfig, savePlaceConfig, serializePlaceConfig } from '@/lib/reputation/review-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #11 — Google Places configuration for the tenant.
 *
 * GET  returns the safe shape only (place_id, has_api_key, last_fetch_at) —
 *       neither the ciphertext nor the decrypted key ever leaves the server.
 * POST upserts { place_id, api_key? }; an absent api_key keeps the stored
 *       one (the UI never echoes it back, so "save place id only" must not
 *       wipe the key).
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getPlaceConfig(tenant.id);
  return NextResponse.json({ config: serializePlaceConfig(config) });
}

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { place_id?: unknown; api_key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const placeId = typeof body.place_id === 'string' ? body.place_id.trim() : '';
  if (!placeId || placeId.length < 6 || placeId.length > 256) {
    return NextResponse.json(
      { error: 'place_id is required (Google Place IDs look like ChIJN1t_tDeuEmsRUsoyG83frY4)' },
      { status: 400 }
    );
  }

  const apiKey =
    typeof body.api_key === 'string' && body.api_key.trim() ? body.api_key.trim() : null;
  if (apiKey && apiKey.length > 256) {
    return NextResponse.json({ error: 'api_key is too long' }, { status: 400 });
  }

  const row = await savePlaceConfig(tenant.id, placeId, apiKey);
  return NextResponse.json({ ok: true, config: serializePlaceConfig(row) });
}
