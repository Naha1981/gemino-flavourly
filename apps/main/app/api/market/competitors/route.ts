import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { googlePlacesConfig, tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getOrCreateTenant } from '@/lib/tenant';
import { listCompetitors, upsertCompetitor } from '@/lib/market/competitor-store';
import { runDiscovery } from '@/lib/market/discovery';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Gate #15 — the market competitor list + manual add + discovery trigger.
 *
 * GET           list tracked competitors (closest first, self excluded)
 * POST          add manually: { name, address?, website?, place_id?, phone? }
 * POST /discover  is a separate route (below) — kept apart so the plain
 *                POST stays cheap while discovery carries its own timeout.
 */

async function getTenantPlaceId(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ placeId: googlePlacesConfig.placeId })
    .from(googlePlacesConfig)
    .where(eq(googlePlacesConfig.tenantId, tenantId))
    .limit(1);
  return row?.placeId ?? null;
}

async function getTenantAddress(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ address: tenants.description, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  // Tenants have no street-address column; the restaurant name + area is
  // the best geocoding anchor available. (Discovery accuracy improves once
  // a place config exists — the self row then carries exact coordinates.)
  return row ? `${row.name}${row.address ? `, ${row.address}` : ''}, South Africa` : null;
}

export const discoveryStore = {
  getTenantPlaceId,
  getTenantAddress,
  upsertCompetitor,
};

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await listCompetitors(tenant.id);
  return NextResponse.json({
    competitors: rows.map((row) => ({
      id: row.id,
      name: row.name,
      google_place_id: row.googlePlaceId,
      address: row.address,
      distance_km: row.distanceKm != null ? Number(row.distanceKm) : null,
      rating: row.rating != null ? Number(row.rating) : null,
      current_rating: Number(row.currentRating),
      review_count: row.reviewCount,
      price_level: row.priceLevel,
      website_url: row.websiteUrl,
      phone: row.phone,
      last_menu_snapshot_at: null, // filled by the detail endpoint
      updated_at: row.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { name?: unknown; address?: unknown; website?: unknown; place_id?: unknown; phone?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const placeId = typeof body.place_id === 'string' ? body.place_id.trim() : `manual-${Date.now()}`;
  const website = typeof body.website === 'string' ? body.website.trim() : null;
  const address = typeof body.address === 'string' ? body.address.trim() : null;
  const phone = typeof body.phone === 'string' ? body.phone.trim() : null;

  if (!name || name.length > 120) {
    return NextResponse.json({ error: 'name is required (max 120 chars)' }, { status: 400 });
  }
  // Manual adds may have no Google Place ID; a synthetic one keeps the
  // (tenant, place) unique key meaningful. It cannot feed rating monitoring
  // (Gate #14 rejects non-Google ids at fetch time) — only menu tracking.
  if (placeId.length < 3 || placeId.length > 256) {
    return NextResponse.json({ error: 'place_id is invalid' }, { status: 400 });
  }
  if (website && !/^https?:\/\//i.test(website)) {
    return NextResponse.json({ error: 'website must be a http(s) URL' }, { status: 400 });
  }

  const { row, inserted } = await upsertCompetitor(tenant.id, {
    name,
    googlePlaceId: placeId,
    address,
    websiteUrl: website,
    phone,
  });

  return NextResponse.json({ ok: true, inserted, competitor: { id: row.id, name: row.name } });
}
