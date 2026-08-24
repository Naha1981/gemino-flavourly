import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getCompetitor, getMenuHistory } from '@/lib/market/competitor-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #16 — menu snapshot timeline for one competitor (the UI highlights
 * added/removed items and price changes between consecutive snapshots).
 * Tenant-gated through the competitor row: a foreign uuid sees [].
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitor = await getCompetitor(tenant.id, params.id);
  if (!competitor) {
    return NextResponse.json({ error: 'Competitor not found' }, { status: 404 });
  }

  const history = await getMenuHistory(tenant.id, params.id);
  return NextResponse.json({
    competitor: { id: competitor.id, name: competitor.name, website_url: competitor.websiteUrl },
    history: history.map((row) => ({
      id: row.id,
      menu_url: row.menuUrl,
      menu_text: row.menuText,
      menu_items: row.menuItems,
      price_range: row.priceRange,
      snapshot_at: row.snapshotAt,
    })),
  });
}
