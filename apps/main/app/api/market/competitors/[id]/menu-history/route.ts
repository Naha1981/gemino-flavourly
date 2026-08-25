import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { listMenuSnapshots } from '@/lib/market/competitor-store';
import { diffMenus, itemsFromText } from '@/lib/market/menu-scraper';

export const dynamic = 'force-dynamic';

/**
 * Gate #16 — one competitor's menu timeline, newest first.
 *
 * Each entry carries the change against the snapshot before it, computed here
 * rather than in the browser: the diff is a pure function of two stored texts,
 * and doing it server-side means the dashboard renders a finished timeline in
 * one round trip (and the same differ is unit-tested in lib/market).
 *
 * Tenant-scoped through the competitor row, so another tenant's competitor id
 * returns 404 rather than an empty list someone could probe.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = Number(new URL(req.url).searchParams.get('limit') ?? '50');
  const rows = await listMenuSnapshots(tenant.id, params.id, Number.isFinite(limit) ? limit : 50);

  const snapshots = rows.map((row, index) => {
    // rows are newest-first, so the previous snapshot is the NEXT element.
    const previous = rows[index + 1];
    const items = itemsFromText(row.menuText);
    const diff = previous ? diffMenus(itemsFromText(previous.menuText), items) : null;

    return {
      id: row.id,
      menu_url: row.menuUrl,
      price_range: row.priceRange,
      snapshot_at: row.snapshotAt,
      item_count: items.length,
      items: items.map((item) => ({ name: item.name, price: item.price, category: item.category })),
      changes: diff
        ? {
            has_changes: diff.hasChanges,
            new_items: diff.newItems.map((item) => item.name),
            removed_items: diff.removedItems.map((item) => item.name),
            price_changes: diff.priceChanges.map((change) => ({
              name: change.name,
              previous_price: change.previousPrice,
              current_price: change.currentPrice,
              delta: change.delta,
            })),
          }
        : null,
    };
  });

  return NextResponse.json({ competitor_id: params.id, snapshots });
}
