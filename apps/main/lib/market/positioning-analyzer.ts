/**
 * Gate #18 — positioning analysis, framework-free.
 *
 * Answers four questions an owner actually asks, using only data the platform
 * already has:
 *
 *   1. PRICE     — where do I sit against the restaurants around me?
 *   2. RATING    — where do I rank on Google?
 *   3. OVERLAP   — how much of a competitor's menu do I already cover?
 *   4. UNIQUENESS— what do I have that nobody else does?
 *
 * Everything is computed from parsed menu items and stored ratings; there is
 * no model call and no network, so the report is deterministic and cheap.
 * Where the data cannot answer a question the report SAYS SO (band 'unknown',
 * rank null) instead of filling the gap with a plausible-looking number.
 */

import { normalizeItemName, type MenuItem } from './menu-scraper.ts';

export type PriceBand = 'budget' | 'mid-range' | 'premium' | 'unknown';

export interface PositioningCompetitor {
  id: string;
  name: string;
  distanceKm: number | null;
  menuItems: MenuItem[];
  googleRating: number | null;
  reviewCount: number | null;
  /** Google's 1-4 band captured at discovery, when there is one. */
  priceLevel: number | null;
}

export type TenantMenuSource = 'menu_text' | 'description' | 'system_prompt' | 'none';

export interface PositioningTenant {
  name: string;
  menuItems: MenuItem[];
  /** Which column the menu was read from — shown in the UI, so the owner
   *  knows whether the comparison used their real menu or a fallback. */
  menuSource: TenantMenuSource;
  googleRating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
}

export interface PositioningInput {
  tenant: PositioningTenant;
  competitors: PositioningCompetitor[];
}

export interface PriceStanding {
  name: string;
  average: number | null;
  isTenant: boolean;
  distanceKm: number | null;
}

export interface RatingStanding {
  name: string;
  rating: number | null;
  reviewCount: number | null;
  isTenant: boolean;
}

export interface OverlapEntry {
  competitorId: string;
  competitorName: string;
  theirItemCount: number;
  sharedItemCount: number;
  overlapPercent: number | null;
  sharedItems: string[];
}

export interface PositioningReport {
  generatedAt: string;
  tenant: {
    name: string;
    menu_items: number;
    menu_source: TenantMenuSource;
    average_price: number | null;
    google_rating: number | null;
    review_count: number | null;
  };
  competitors_analysed: number;
  price: {
    band: PriceBand;
    average: number | null;
    /** 0 = cheapest in the market, 100 = dearest. Null when there is nothing to compare. */
    percentile: number | null;
    standings: PriceStanding[];
    summary: string;
  };
  rating: {
    rank: number | null;
    total: number;
    /** 100 = best rated in the market. */
    percentile: number | null;
    standings: RatingStanding[];
    summary: string;
  };
  menu_overlap: {
    average_percent: number | null;
    per_competitor: OverlapEntry[];
    summary: string;
  };
  unique_offerings: {
    items: string[];
    count: number;
    summary: string;
  };
  headline: string;
}

/** Google's 1-4 priceLevel, for the summary copy only. */
export const PRICE_LEVEL_LABELS: Record<number, string> = {
  0: 'free',
  1: 'inexpensive',
  2: 'moderate',
  3: 'expensive',
  4: 'very expensive',
};

export function averageMenuPrice(items: MenuItem[]): number | null {
  const prices = items.map((item) => item.price).filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length === 0) return null;
  return Math.round((prices.reduce((total, price) => total + price, 0) / prices.length) * 100) / 100;
}

function normalizedNames(items: MenuItem[]): Set<string> {
  const set = new Set<string>();
  for (const item of items) {
    const key = normalizeItemName(item.name);
    if (key) set.add(key);
  }
  return set;
}

/** 0 = cheapest, 100 = dearest among the priced entries. */
export function pricePercentile(tenantAverage: number, standings: Array<{ average: number | null }>): number {
  const priced = standings.filter((entry): entry is { average: number } => entry.average !== null);
  if (priced.length === 0) return 0;
  const cheaper = priced.filter((entry) => entry.average < tenantAverage).length;
  return Math.round((cheaper / priced.length) * 100);
}

/** Budget below the 33rd percentile, premium above the 66th. */
export function priceBandOf(percentile: number | null): PriceBand {
  if (percentile === null) return 'unknown';
  if (percentile < 33) return 'budget';
  if (percentile > 66) return 'premium';
  return 'mid-range';
}

function ordinal(rank: number): string {
  const remainder = rank % 100;
  if (remainder >= 11 && remainder <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

export interface PositioningOptions {
  now?: Date;
  currency?: string;
}

/**
 * Build the positioning report. Pure: the same input always produces the
 * same output (including `generatedAt`, which comes from `options.now`).
 */
export function buildPositioningReport(
  input: PositioningInput,
  options: PositioningOptions = {}
): PositioningReport {
  const now = options.now ?? new Date();
  const currency = options.currency ?? 'R';
  const tenant = input.tenant;

  const tenantAverage = averageMenuPrice(tenant.menuItems);
  const tenantItems = normalizedNames(tenant.menuItems);

  // ── price ─────────────────────────────────────────────────────────────────
  const priceStandings: PriceStanding[] = [
    { name: tenant.name || 'You', average: tenantAverage, isTenant: true, distanceKm: null },
    ...input.competitors.map((competitor) => ({
      name: competitor.name,
      average: averageMenuPrice(competitor.menuItems),
      isTenant: false,
      distanceKm: competitor.distanceKm,
    })),
  ].sort((a, b) => {
    if (a.average === null && b.average === null) return 0;
    if (a.average === null) return 1;
    if (b.average === null) return -1;
    return a.average - b.average;
  });

  const competitorAverages = input.competitors
    .map((competitor) => averageMenuPrice(competitor.menuItems))
    .filter((average): average is number => average !== null);

  const percentile = tenantAverage === null || competitorAverages.length === 0 ? null : pricePercentile(tenantAverage, priceStandings);
  const band = priceBandOf(percentile);

  const pricedCompetitors = priceStandings.filter((entry) => !entry.isTenant && entry.average !== null);
  const priceSummary =
    tenantAverage === null
      ? tenant.menuItems.length === 0
        ? 'No menu on record, so there is nothing to price against. Add your menu in Settings to unlock this.'
        : 'Your menu has no prices, so no price position could be computed.'
      : competitorAverages.length === 0
        ? `Your menu averages ${currency}${Math.round(tenantAverage)} per dish, but no competitor menu with prices was scraped yet.`
        : `Your menu averages ${currency}${Math.round(tenantAverage)} per dish — ${band} for this market ` +
          `(${pricedCompetitors.length} competitor${pricedCompetitors.length === 1 ? '' : 's'} priced, ` +
          `cheapest ${currency}${Math.round(Math.min(...(pricedCompetitors.map((entry) => entry.average as number).concat([tenantAverage]))))}, ` +
          `dearest ${currency}${Math.round(Math.max(...(pricedCompetitors.map((entry) => entry.average as number).concat([tenantAverage]))))}).`;

  // ── rating ────────────────────────────────────────────────────────────────
  const ratingStandings: RatingStanding[] = [
    {
      name: tenant.name || 'You',
      rating: tenant.googleRating,
      reviewCount: tenant.reviewCount,
      isTenant: true,
    },
    ...input.competitors.map((competitor) => ({
      name: competitor.name,
      rating: competitor.googleRating,
      reviewCount: competitor.reviewCount,
      isTenant: false,
    })),
  ].sort((a, b) => {
    if (a.rating === null && b.rating === null) return 0;
    if (a.rating === null) return 1;
    if (b.rating === null) return -1;
    if (b.rating !== a.rating) return b.rating - a.rating;
    // Equal stars: more reviews is the stronger listing.
    return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
  });

  const rated = ratingStandings.filter((entry) => entry.rating !== null);
  const tenantRank = tenant.googleRating === null ? null : rated.findIndex((entry) => entry.isTenant) + 1;
  const ratingPercentile =
    tenantRank === null || rated.length <= 1 ? null : Math.round(((rated.length - tenantRank) / (rated.length - 1)) * 100);

  const ratingSummary = (() => {
    if (tenant.googleRating === null) {
      return 'No Google rating on record for you yet, so no ranking could be computed.';
    }
    if (rated.length <= 1) {
      return `You have a ${tenant.googleRating.toFixed(1)}★ rating, but no competitor rating is stored to rank against.`;
    }
    // Defensive: the tenant has a rating, so it is in `rated` by construction.
    if (tenantRank === null) {
      return `You have a ${tenant.googleRating.toFixed(1)}★ rating, but your listing could not be placed in the ranking.`;
    }
    const best = rated[0].rating as number;
    return (
      `You rank ${ordinal(tenantRank)} of ${rated.length} on Google rating ` +
      `(${tenant.googleRating.toFixed(1)}★ vs the local best of ${best.toFixed(1)}★).`
    );
  })();

  // ── menu overlap ──────────────────────────────────────────────────────────
  // With no tenant menu on record, overlap is UNKNOWN rather than 0% — "you
  // cover none of their menu" is a claim about a menu we have never seen.
  const tenantHasMenu = tenantItems.size > 0;
  const perCompetitor: OverlapEntry[] = input.competitors.map((competitor) => {
    const theirItems = normalizedNames(competitor.menuItems);
    const shared: string[] = [];
    theirItems.forEach((key) => {
      if (tenantItems.has(key)) shared.push(key);
    });
    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      theirItemCount: theirItems.size,
      sharedItemCount: shared.length,
      overlapPercent: !tenantHasMenu || theirItems.size === 0 ? null : Math.round((shared.length / theirItems.size) * 100),
      sharedItems: shared.sort().slice(0, 8),
    };
  });

  const measurable = perCompetitor.filter((entry) => entry.overlapPercent !== null);
  const averageOverlap =
    measurable.length === 0
      ? null
      : Math.round(measurable.reduce((total, entry) => total + (entry.overlapPercent as number), 0) / measurable.length);

  const overlapSummary =
    tenant.menuItems.length === 0
      ? 'Add your menu in Settings to see how much of each competitor menu you already cover.'
      : measurable.length === 0
        ? 'No competitor menu has been scraped yet, so there is nothing to compare against.'
        : `On average you cover ${averageOverlap}% of a competitor menu. ` +
          (averageOverlap !== null && averageOverlap >= 70
            ? 'That is close to interchangeable — differentiation matters more than coverage.'
            : 'There is room to close the gap on the dishes you are missing.');

  // ── unique offerings ──────────────────────────────────────────────────────
  const competitorNames = new Set<string>();
  for (const competitor of input.competitors) {
    normalizedNames(competitor.menuItems).forEach((key) => competitorNames.add(key));
  }

  const uniqueItems = tenant.menuItems
    .filter((item) => {
      const key = normalizeItemName(item.name);
      return key.length > 0 && !competitorNames.has(key);
    })
    .map((item) => item.name);

  const uniqueSummary =
    tenant.menuItems.length === 0
      ? 'No menu on record, so no unique dishes could be identified.'
      : input.competitors.length === 0
        ? 'No competitors tracked yet, so everything on your menu is technically unique.'
        : uniqueItems.length === 0
          ? 'Every dish on your menu appears somewhere nearby — your edge has to be price, service or reputation.'
          : `${uniqueItems.length} of your ${tenant.menuItems.length} dishes are not on any competitor menu nearby. ` +
            'These are your unique selling points: lead with them in replies and on the menu page.';

  const headline = [
    tenantAverage !== null ? `${currency}${Math.round(tenantAverage)} average dish price (${band})` : 'no price data',
    tenantRank !== null ? `${ordinal(tenantRank)} of ${rated.length} on Google rating` : 'no Google rating',
    uniqueItems.length > 0 ? `${uniqueItems.length} unique dish${uniqueItems.length === 1 ? '' : 'es'}` : 'no unique dishes',
  ].join(' · ');

  return {
    generatedAt: now.toISOString(),
    tenant: {
      name: tenant.name || 'You',
      menu_items: tenant.menuItems.length,
      menu_source: tenant.menuSource,
      average_price: tenantAverage,
      google_rating: tenant.googleRating,
      review_count: tenant.reviewCount,
    },
    competitors_analysed: input.competitors.length,
    price: {
      band,
      average: tenantAverage,
      percentile,
      standings: priceStandings,
      summary: priceSummary,
    },
    rating: {
      rank: tenantRank === 0 ? null : tenantRank,
      total: rated.length,
      percentile: ratingPercentile,
      standings: ratingStandings,
      summary: ratingSummary,
    },
    menu_overlap: {
      average_percent: averageOverlap,
      per_competitor: perCompetitor.sort((a, b) => (b.overlapPercent ?? -1) - (a.overlapPercent ?? -1)),
      summary: overlapSummary,
    },
    unique_offerings: {
      items: uniqueItems,
      count: uniqueItems.length,
      summary: uniqueSummary,
    },
    headline,
  };
}
