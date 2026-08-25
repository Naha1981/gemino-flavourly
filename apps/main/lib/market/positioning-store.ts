import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { googleReviews, tenants } from '@/lib/db/schema';
import { parseMenuItems, type MenuItem } from './menu-scraper.ts';
import {
  buildPositioningReport,
  pickTenantMenu,
  type PositioningCompetitor,
  type PositioningInput,
  type PositioningOptions,
  type PositioningReport,
} from './positioning-analyzer.ts';
import { latestSnapshotsByCompetitor, listCompetitors, type PlaceData } from './competitor-store.ts';

/**
 * Gate #18 — Drizzle adapter for positioning analysis.
 *
 * The analyzer is pure; this file assembles its input from stored data and
 * nothing else. Everything is tenant-scoped (there is no platform-wide view
 * of positioning — it is by definition one restaurant against its own
 * neighbourhood).
 */

/** How far back the tenant's own Google rating is averaged over. */
const TENANT_RATING_WINDOW_DAYS = 365;

/** The tenant's own average Google rating from its synced reviews. */
export async function tenantGoogleRating(
  tenantId: string,
  days = TENANT_RATING_WINDOW_DAYS
): Promise<{ rating: number | null; reviewCount: number | null }> {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({
      average: sql<number | null>`AVG(${googleReviews.rating})`,
      total: sql<number>`count(*)::int`,
    })
    .from(googleReviews)
    .where(and(eq(googleReviews.tenantId, tenantId), gte(googleReviews.time, since)));

  const total = Number(row?.total ?? 0);
  if (total === 0 || row?.average === null || row?.average === undefined) {
    return { rating: null, reviewCount: null };
  }
  return { rating: Math.round(Number(row.average) * 10) / 10, reviewCount: total };
}

/** Competitor rows + newest snapshots, shaped for the analyzer. */
export async function collectPositioningCompetitors(tenantId: string): Promise<PositioningCompetitor[]> {
  const [rows, snapshots] = await Promise.all([listCompetitors(tenantId), latestSnapshotsByCompetitor(tenantId)]);

  return rows.map((row) => {
    const snapshot = snapshots.get(row.id) ?? null;
    const place = (row.placeData ?? {}) as PlaceData;
    const rating = Number(row.currentRating);
    return {
      id: row.id,
      name: row.name,
      distanceKm: row.distanceKm === null ? null : Number(row.distanceKm),
      menuItems: parseSnapshotItems(snapshot?.menuText ?? null),
      googleRating: Number.isFinite(rating) && rating > 0 ? rating : null,
      reviewCount: row.reviewCount > 0 ? row.reviewCount : null,
      priceLevel: typeof place.priceLevel === 'number' ? place.priceLevel : null,
    };
  });
}

/**
 * Menu items from a stored snapshot.
 *
 * Snapshots store the parsed dish list (see menuSnapshotText in
 * lib/market/menu-scraper.ts), so re-parsing reproduces the same items and
 * the comparison is like-for-like rather than text-vs-text.
 */
export function parseSnapshotItems(menuText: string | null): MenuItem[] {
  return parseMenuItems(menuText ?? '');
}

/** Assemble the analyzer input for one tenant. */
export async function collectPositioningInput(tenantId: string): Promise<PositioningInput> {
  const [row] = await db
    .select({
      name: tenants.name,
      menuText: tenants.menuText,
      description: tenants.description,
      systemPrompt: tenants.systemPrompt,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const [rating, competitors] = await Promise.all([
    tenantGoogleRating(tenantId),
    collectPositioningCompetitors(tenantId),
  ]);

  const menu = pickTenantMenu({
    menuText: row?.menuText ?? null,
    description: row?.description ?? null,
    systemPrompt: row?.systemPrompt ?? null,
  });

  return {
    tenant: {
      name: row?.name ?? 'Your restaurant',
      menuItems: parseMenuItems(menu.text ?? ''),
      menuSource: menu.source,
      googleRating: rating.rating,
      reviewCount: rating.reviewCount,
      // The tenant's own Google price level is not stored anywhere; null keeps
      // the report honest instead of borrowing a competitor's band.
      priceLevel: null,
    },
    competitors,
  };
}

/** Build the report for one tenant. */
export async function getPositioningReport(
  tenantId: string,
  options: PositioningOptions = {}
): Promise<PositioningReport> {
  const input = await collectPositioningInput(tenantId);
  return buildPositioningReport(input, options);
}
