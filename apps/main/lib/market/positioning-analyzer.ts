/**
 * Gate #18 — positioning analysis, framework-free.
 *
 * Compares the tenant against their tracked competitors on three axes:
 *
 *   price   — where the tenant's average parsed menu price sits in the
 *             market's min..max band (budget / mid-range / premium), plus
 *             the market's own price-class distribution
 *   rating  — the tenant's rank among all ratings (their Google reviews
 *             average vs each competitor's current rating)
 *   menu    — overlap (share of competitor items the tenant also offers)
 *             and unique offerings (tenant items no competitor has)
 *
 * Every input is supplied by the caller; every output is derived here, so
 * the whole report is unit-testable without a database.
 */

export type PriceClass = 'budget' | 'mid-range' | 'premium';

export interface PositioningCompetitorInput {
  name: string;
  rating: number | null;
  /** Average parsed item price, rands (from the latest menu snapshot). */
  avgItemRands: number | null;
  menuItems: string[];
}

export interface PositioningTenantInput {
  name: string;
  /** Average Google review rating (Engine 3), 0 when no reviews yet. */
  rating: number;
  avgItemRands: number | null;
  menuItems: string[];
}

export interface MenuOverlapRow {
  competitor: string;
  /** 0..1 share of the competitor's items the tenant also offers. */
  overlap: number;
  sharedCount: number;
  competitorItemCount: number;
}

export interface PositioningReport {
  price: {
    tenantClass: PriceClass | 'unknown';
    tenantAvgRands: number | null;
    marketMinRands: number | null;
    marketMaxRands: number | null;
    marketAvgRands: number | null;
    competitorClasses: Array<{ competitor: string; priceClass: PriceClass }>;
    summary: string;
  };
  rating: {
    tenantRating: number;
    rank: number;
    of: number;
    marketAvg: number | null;
    aheadOf: string[];
    summary: string;
  };
  menu: {
    overlapRows: MenuOverlapRow[];
    averageOverlap: number | null;
    uniqueOfferings: string[];
    summary: string;
  };
}

/** Price band thresholds (rands, average item). */
export const BUDGET_MAX_RANDS = 100;
export const PREMIUM_MIN_RANDS = 220;

export function classifyPrice(avgRands: number): PriceClass {
  if (avgRands <= BUDGET_MAX_RANDS) return 'budget';
  if (avgRands >= PREMIUM_MIN_RANDS) return 'premium';
  return 'mid-range';
}

function normalizeItem(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeItems(items: string[]): Set<string> {
  const set = new Set<string>();
  for (const item of items) {
    const normalized = normalizeItem(item);
    if (normalized.length >= 3) set.add(normalized);
  }
  return set;
}

/** Exact-name matching after normalization — conservative on purpose:
 *  "Peri-peri chicken" ≠ "Chicken peri-peri" is an undercount, which is
 *  always the honest direction for an overlap claim. */
function itemOverlap(tenantItems: Set<string>, competitorItems: Set<string>): number {
  if (competitorItems.size === 0) return 0;
  let shared = 0;
  for (const item of Array.from(competitorItems.values())) {
    if (tenantItems.has(item)) shared += 1;
  }
  return shared / competitorItems.size;
}

export function buildPositioningReport(
  tenant: PositioningTenantInput,
  competitors: PositioningCompetitorInput[]
): PositioningReport {
  // ---- price ---------------------------------------------------------------
  const marketPrices = competitors
    .map((c) => c.avgItemRands)
    .filter((value): value is number => value != null && Number.isFinite(value));

  const marketMin = marketPrices.length > 0 ? Math.min(...marketPrices) : null;
  const marketMax = marketPrices.length > 0 ? Math.max(...marketPrices) : null;
  const marketAvg = marketPrices.length > 0 ? marketPrices.reduce((a, b) => a + b, 0) / marketPrices.length : null;
  const tenantClass = tenant.avgItemRands != null ? classifyPrice(tenant.avgItemRands) : 'unknown';

  const competitorClasses = competitors
    .filter((c) => c.avgItemRands != null)
    .map((c) => ({ competitor: c.name, priceClass: classifyPrice(c.avgItemRands as number) }));

  let priceSummary: string;
  if (tenant.avgItemRands == null || marketPrices.length === 0) {
    priceSummary = 'Not enough menu pricing tracked yet to position you against the market.';
  } else {
    priceSummary = `Your average item price (R${tenant.avgItemRands.toFixed(0)}) positions you as ${tenantClass} in a market ranging R${(marketMin as number).toFixed(0)}-R${(marketMax as number).toFixed(0)}.`;
  }

  // ---- rating ----------------------------------------------------------------
  const rated = [
    { name: tenant.name, rating: tenant.rating, isTenant: true },
    ...competitors
      .filter((c) => c.rating != null && c.rating > 0)
      .map((c) => ({ name: c.name, rating: c.rating as number, isTenant: false })),
  ].sort((a, b) => b.rating - a.rating);

  const tenantIndex = rated.findIndex((entry) => entry.isTenant);
  // A rank of #1-of-1 against zero competitors is not a position — rank
  // only exists once there is something to be ranked against.
  const rank = tenantIndex >= 0 && rated.length > 1 ? tenantIndex + 1 : 0;
  const competitorRatings = rated.filter((e) => !e.isTenant).map((e) => e.rating);
  const marketRatingAvg =
    competitorRatings.length > 0
      ? competitorRatings.reduce((a, b) => a + b, 0) / competitorRatings.length
      : null;
  const aheadOf = tenantIndex >= 0 ? rated.slice(tenantIndex + 1).map((entry) => entry.name) : [];

  const ratingSummary =
    rank > 0 && rated.length > 1
      ? `Your ${tenant.rating.toFixed(1)}★ ranks #${rank} of ${rated.length} in your tracked market${marketRatingAvg != null ? ` (market average ${marketRatingAvg.toFixed(1)}★)` : ''}.`
      : 'No competitor ratings tracked yet — positioning unlocks once discovery has ratings.';

  // ---- menu ------------------------------------------------------------------
  const tenantItemSet = normalizeItems(tenant.menuItems);
  const overlapRows: MenuOverlapRow[] = [];
  const uniqueToTenant = new Set(Array.from(tenantItemSet.values()));
  let overlapSum = 0;
  let overlapCount = 0;

  for (const competitor of competitors) {
    const competitorItemSet = normalizeItems(competitor.menuItems);
    if (competitorItemSet.size === 0) continue;

    const overlap = itemOverlap(tenantItemSet, competitorItemSet);
    overlapRows.push({
      competitor: competitor.name,
      overlap,
      sharedCount: Math.round(overlap * competitorItemSet.size),
      competitorItemCount: competitorItemSet.size,
    });
    overlapSum += overlap;
    overlapCount += 1;

    for (const item of Array.from(competitorItemSet.values())) {
      uniqueToTenant.delete(item);
    }
  }

  const averageOverlap = overlapCount > 0 ? overlapSum / overlapCount : null;
  const menuSummary =
    overlapCount === 0
      ? 'No competitor menus parsed yet — overlap analysis unlocks once the 8am tracker has snapshots.'
      : averageOverlap != null
        ? `You share ${(averageOverlap * 100).toFixed(0)}% of competitors' menu items on average, and have ${uniqueToTenant.size} items nobody else offers.`
        : 'Menu comparison unavailable.';

  return {
    price: {
      tenantClass,
      tenantAvgRands: tenant.avgItemRands,
      marketMinRands: marketMin,
      marketMaxRands: marketMax,
      marketAvgRands: marketAvg,
      competitorClasses,
      summary: priceSummary,
    },
    rating: {
      tenantRating: tenant.rating,
      rank,
      of: rated.length,
      marketAvg: marketRatingAvg,
      aheadOf,
      summary: ratingSummary,
    },
    menu: {
      overlapRows,
      averageOverlap,
      uniqueOfferings: Array.from(uniqueToTenant.values()).slice(0, 20),
      summary: menuSummary,
    },
  };
}
