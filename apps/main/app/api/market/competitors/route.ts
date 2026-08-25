import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  createCompetitor,
  latestSnapshotsByCompetitor,
  listCompetitors,
  promotionCountsByCompetitor,
} from '@/lib/market/competitor-store';
import { serializeCompetitor } from '@/lib/market/serialization';

export const dynamic = 'force-dynamic';

/**
 * Gate #15 — the tenant's tracked competitors, nearest first, each with the
 * date of its newest menu snapshot and a promotion count. Everything returned
 * belongs to the signed-in tenant.
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [rows, snapshots, promotionCounts] = await Promise.all([
    listCompetitors(tenant.id),
    latestSnapshotsByCompetitor(tenant.id),
    promotionCountsByCompetitor(tenant.id),
  ]);

  const competitors = rows.map((row) => {
    const snapshot = snapshots.get(row.id) ?? null;
    return {
      ...serializeCompetitor(row),
      last_menu_snapshot_at: snapshot?.snapshotAt ?? null,
      last_menu_price_range: snapshot?.priceRange ?? null,
      promotion_count: promotionCounts.get(row.id) ?? 0,
    };
  });

  return NextResponse.json({
    competitors,
    tenant_location: {
      address: tenant.address,
      latitude: tenant.latitude === null ? null : Number(tenant.latitude),
      longitude: tenant.longitude === null ? null : Number(tenant.longitude),
    },
  });
}

/**
 * Gate #15 — "Add Manually": track a competitor the tenant knows about that
 * discovery did not surface. No Google place id is required — menu and
 * promotion tracking work from the website alone (the rating sweep simply
 * skips rows without one).
 */
export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: unknown; address?: unknown; website_url?: unknown; phone?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 160) {
    return NextResponse.json({ error: 'name is required (max 160 chars)' }, { status: 400 });
  }

  const address = typeof body.address === 'string' && body.address.trim() ? body.address.trim().slice(0, 500) : null;
  const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim().slice(0, 64) : null;

  let websiteUrl: string | null = null;
  if (typeof body.website_url === 'string' && body.website_url.trim()) {
    const raw = body.website_url.trim();
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return NextResponse.json({ error: 'website_url must be a full URL (https://…)' }, { status: 400 });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'website_url must be an http(s) URL' }, { status: 400 });
    }
    websiteUrl = parsed.toString().slice(0, 500);
  }

  const row = await createCompetitor(tenant.id, { name, address, websiteUrl, phone });
  return NextResponse.json({ ok: true, competitor: serializeCompetitor(row) }, { status: 201 });
}
