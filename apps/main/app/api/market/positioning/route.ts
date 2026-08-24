import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getLatestMenuSnapshot, listCompetitors, getSelfCompetitor } from '@/lib/market/competitor-store';
import { buildPositioningReport } from '@/lib/market/positioning-analyzer';
import { getAverageRating } from '@/lib/reputation/review-store';

export const dynamic = 'force-dynamic';

interface ParsedItems {
  names: string[];
  avgRands: number | null;
}

function parseSnapshot(raw: unknown): ParsedItems {
  if (!Array.isArray(raw) || raw.length === 0) return { names: [], avgRands: null };
  const items = raw as Array<{ name?: unknown; priceCents?: unknown }>;
  const priced = items.filter(
    (item) => typeof item?.name === 'string' && typeof item?.priceCents === 'number'
  );
  if (priced.length === 0) return { names: [], avgRands: null };
  const totalCents = priced.reduce((sum, item) => sum + (item.priceCents as number), 0);
  return {
    names: priced.map((item) => item.name as string),
    avgRands: totalCents / priced.length / 100,
  };
}

/**
 * Gate #18 — positioning report: the tenant's rating (Engine 3 review data)
 * and menu (their is_self competitor row's latest snapshot, populated by
 * discovery + the 8am tracker) against every tracked competitor.
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [selfRow, competitorRows, tenantRating] = await Promise.all([
    getSelfCompetitor(tenant.id),
    listCompetitors(tenant.id),
    getAverageRating(tenant.id).catch(() => 0),
  ]);

  const selfSnapshot = selfRow
    ? await getLatestMenuSnapshot(selfRow.id).catch(() => null)
    : null;
  const selfMenu = parseSnapshot(selfSnapshot?.menuItems);
  const selfWebsite = selfRow?.websiteUrl ?? null;

  const competitors = await Promise.all(
    competitorRows.map(async (row) => {
      const snapshot = await getLatestMenuSnapshot(row.id).catch(() => null);
      const parsed = parseSnapshot(snapshot?.menuItems);
      return {
        name: row.name,
        rating: row.rating != null ? Number(row.rating) : null,
        avgItemRands: parsed.avgRands,
        menuItems: parsed.names,
      };
    })
  );

  const report = buildPositioningReport(
    {
      name: tenant.name,
      rating: tenantRating,
      avgItemRands: selfMenu.avgRands,
      menuItems: selfMenu.names,
    },
    competitors
  );

  return NextResponse.json({
    report,
    tenant_menu_tracked: selfMenu.names.length > 0,
    tenant_website: selfWebsite,
    hint:
      selfMenu.names.length === 0
        ? 'Your own menu is not tracked yet — run Discover Competitors (it tags your Google place as "self") or add your website to start the comparison.'
        : null,
  });
}
