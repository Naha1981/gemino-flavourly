/**
 * Gate #16 — competitor change alerts and the tracking sweep.
 *
 * Two pieces that belong together:
 *
 *   1. The alert COPY. Pure functions, so the exact wording an owner sees is
 *      unit-tested rather than discovered in production.
 *   2. The framework-free cron RUNNER. It owns the order of operations
 *      (scrape -> diff -> snapshot -> alert) and takes its store and its two
 *      network functions as arguments, so the whole sweep is testable with
 *      in-memory fakes — no database, no HTTP.
 *
 * The Drizzle adapter lives in ./competitor-store.ts; the Next.js route in
 * app/api/cron/track-competitors/route.ts does nothing but authorize the
 * request and wire the real implementations into runCompetitorTrackingCron.
 */

import type { MenuDiff } from './menu-scraper.ts';
import type { DetectedPromotion } from './promotion-detector.ts';

/** Identifies market alerts in the tenant's system message stream. */
export const MARKET_ALERT_PREFIX = '⚠️ Market Alert:';

/** How many items a single alert lists before it says "+N more". */
const MAX_LISTED_ITEMS = 3;
/** Ceiling on promotion alerts per competitor per run (a page can be noisy). */
const MAX_PROMOTION_ALERTS_PER_RUN = 3;

function listOf(values: string[]): string {
  if (values.length === 0) return 'none';
  if (values.length <= MAX_LISTED_ITEMS) return values.join(', ');
  return `${values.slice(0, MAX_LISTED_ITEMS).join(', ')} (+${values.length - MAX_LISTED_ITEMS} more)`;
}

/** "Ribeye steak R280->R320" — the direction of the move is the point. */
function priceChangeLabel(change: { name: string; previousPrice: number; currentPrice: number }): string {
  return `${change.name} R${change.previousPrice}→R${change.currentPrice}`;
}

/**
 * "⚠️ Market Alert: The Bull Pen updated their menu. New items: X. Price
 * changes: Y." Removals are appended only when there are some — the gate's
 * sentence shape is kept intact for the two required parts.
 */
export function formatMenuChangeAlert(competitorName: string, diff: MenuDiff): string {
  const parts = [
    `${MARKET_ALERT_PREFIX} ${competitorName} updated their menu.`,
    `New items: ${listOf(diff.newItems.map((item) => item.name))}.`,
    `Price changes: ${listOf(diff.priceChanges.map(priceChangeLabel))}.`,
  ];
  if (diff.removedItems.length > 0) {
    parts.push(`Removed items: ${listOf(diff.removedItems.map((item) => item.name))}.`);
  }
  return parts.join(' ');
}

/** "⚠️ Market Alert: The Bull Pen launched a promotion: <the offer text>." */
export function formatPromotionAlert(competitorName: string, promotionText: string): string {
  return `${MARKET_ALERT_PREFIX} ${competitorName} launched a promotion: ${promotionText.trim()}`;
}

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

export interface TrackedCompetitor {
  id: string;
  tenantId: string;
  name: string;
  websiteUrl: string | null;
}

export interface MenuSnapshotRecord {
  menuUrl: string | null;
  menuText: string | null;
  priceRange: string | null;
  snapshotAt: Date;
}

export interface CompetitorTrackingStore {
  /** Every competitor platform-wide that has a website to check. */
  findTrackedCompetitors(): Promise<TrackedCompetitor[]>;
  /** The baseline the next scrape is diffed against. */
  getLatestMenuSnapshot(competitorId: string): Promise<MenuSnapshotRecord | null>;
  /** Persist a NEW snapshot (append-only timeline). */
  saveMenuSnapshot(
    competitorId: string,
    menuUrl: string | null,
    menuText: string | null,
    priceRange: string | null
  ): Promise<void>;
  /** Promotions already recorded in the lookback window (dedupe input). */
  getRecentPromotions(competitorId: string, days: number): Promise<Array<{ promotionText: string }>>;
  savePromotion(competitorId: string, promotionText: string, source: string | null): Promise<void>;
  /** Surface the alert in the tenant's inbox as a system message. */
  createAlert(tenantId: string, text: string): Promise<void>;
  /** Optional: remember a discovered /menu URL so later runs skip the hop. */
  saveDiscoveredMenuUrl?(competitorId: string, menuUrl: string): Promise<void>;
}

/** Structurally identical to lib/market/menu-scraper's MenuItem. */
export interface MenuItemLike {
  name: string;
  price: number;
  category: string | null;
}

/** Injected network functions (the real ones come from lib/market/*). */
export interface TrackingDependencies {
  scrapeMenuFn: (url: string, options?: { previousItems?: MenuItemLike[] }) => Promise<{
    menuUrl: string;
    menuText: string;
    items: MenuItemLike[];
    priceRange: string | null;
    diff: MenuDiff;
  }>;
  detectPromotionsFn: (url: string) => Promise<DetectedPromotion[]>;
  /** Serialize a snapshot for storage (items -> text). */
  menuSnapshotTextFn: (scraped: { menuText: string; items: MenuItemLike[] }) => string;
  /** Read a stored snapshot's items back out, for the next diff. */
  itemsFromTextFn: (text: string | null) => MenuItemLike[];
  /** Fresh-detection filter against stored promotions. */
  newPromotionsFn: (
    detected: DetectedPromotion[],
    stored: Array<{ promotionText: string }>
  ) => DetectedPromotion[];
}

export interface TrackingOptions {
  now?: Date;
  /** How far back to look when deciding a promotion is new (default 30 days). */
  promotionLookbackDays?: number;
  /** Ceiling on competitors processed per run. */
  limit?: number;
}

export interface TrackingSummary {
  competitorsChecked: number;
  menusScraped: number;
  baselinesSaved: number;
  menuChangesDetected: number;
  snapshotsSaved: number;
  promotionsDetected: number;
  newPromotionsSaved: number;
  alertsCreated: number;
  skipped: {
    noWebsite: number;
    scrapeFailed: number;
    promotionFailed: number;
    noMenuItems: number;
    failed: number;
  };
  samples: Array<{ competitorId: string; name: string; menuChanged: boolean; newPromotions: number }>;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_LOOKBACK_DAYS = 30;

/**
 * One daily sweep.
 *
 * For each competitor with a website: scrape the menu, diff it against the
 * newest snapshot, and — when something moved — store the new snapshot and
 * raise an inbox alert. Then scan the same site for promotions and alert on
 * the ones not seen in the lookback window.
 *
 * A FIRST scrape is a baseline: it is stored but never alerted. Every new
 * competitor would otherwise announce itself as "they just rewrote their
 * menu", which is the fastest possible way to get the alert stream muted.
 *
 * Failures are per-competitor and counted, never fatal: one dead website
 * must not stop the sweep of the other forty.
 */
export async function runCompetitorTrackingCron(
  store: CompetitorTrackingStore,
  deps: TrackingDependencies,
  options: TrackingOptions = {}
): Promise<TrackingSummary> {
  const summary: TrackingSummary = {
    competitorsChecked: 0,
    menusScraped: 0,
    baselinesSaved: 0,
    menuChangesDetected: 0,
    snapshotsSaved: 0,
    promotionsDetected: 0,
    newPromotionsSaved: 0,
    alertsCreated: 0,
    skipped: { noWebsite: 0, scrapeFailed: 0, promotionFailed: 0, noMenuItems: 0, failed: 0 },
    samples: [],
  };

  const limit =
    typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? options.limit
      : DEFAULT_LIMIT;
  const lookbackDays =
    typeof options.promotionLookbackDays === 'number' && options.promotionLookbackDays > 0
      ? options.promotionLookbackDays
      : DEFAULT_LOOKBACK_DAYS;

  let competitors: TrackedCompetitor[] = [];
  try {
    competitors = await store.findTrackedCompetitors();
  } catch (err) {
    console.error('[MarketTracking] Failed to load competitors', err);
    summary.skipped.failed += 1;
    return summary;
  }

  for (const competitor of competitors) {
    if (summary.competitorsChecked >= limit) break;
    summary.competitorsChecked += 1;

    const sample = { competitorId: competitor.id, name: competitor.name, menuChanged: false, newPromotions: 0 };

    if (!competitor.websiteUrl) {
      summary.skipped.noWebsite += 1;
      continue;
    }

    // ── menu ────────────────────────────────────────────────────────────────
    try {
      const previous = await store.getLatestMenuSnapshot(competitor.id);
      const previousItems = previous ? deps.itemsFromTextFn(previous.menuText) : [];
      const scraped = await deps.scrapeMenuFn(competitor.websiteUrl, { previousItems });
      summary.menusScraped += 1;

      if (scraped.items.length === 0) {
        // Nothing parseable: storing an empty baseline would make the NEXT
        // scrape look like a total menu rewrite, so nothing is written.
        summary.skipped.noMenuItems += 1;
      } else if (!previous) {
        await store.saveMenuSnapshot(
          competitor.id,
          scraped.menuUrl,
          deps.menuSnapshotTextFn(scraped),
          scraped.priceRange
        );
        summary.baselinesSaved += 1;
        summary.snapshotsSaved += 1;
      } else if (scraped.diff.hasChanges) {
        await store.saveMenuSnapshot(
          competitor.id,
          scraped.menuUrl,
          deps.menuSnapshotTextFn(scraped),
          scraped.priceRange
        );
        summary.snapshotsSaved += 1;
        summary.menuChangesDetected += 1;
        sample.menuChanged = true;

        await store.createAlert(competitor.tenantId, formatMenuChangeAlert(competitor.name, scraped.diff));
        summary.alertsCreated += 1;
      }

      // The scraper may have followed a /menu link; remembering it means the
      // next run fetches the menu directly.
      if (scraped.menuUrl && scraped.menuUrl !== competitor.websiteUrl && store.saveDiscoveredMenuUrl) {
        await store.saveDiscoveredMenuUrl(competitor.id, scraped.menuUrl);
      }
    } catch (err) {
      summary.skipped.scrapeFailed += 1;
      console.error(`[MarketTracking] Menu scrape failed for competitor ${competitor.id}`, err);
    }

    // ── promotions ──────────────────────────────────────────────────────────
    try {
      const detected = await deps.detectPromotionsFn(competitor.websiteUrl);
      summary.promotionsDetected += detected.length;

      if (detected.length > 0) {
        const stored = await store.getRecentPromotions(competitor.id, lookbackDays);
        const fresh = deps.newPromotionsFn(detected, stored);

        let alerted = 0;
        for (const promotion of fresh) {
          await store.savePromotion(competitor.id, promotion.promotionText, promotion.source);
          summary.newPromotionsSaved += 1;
          sample.newPromotions += 1;

          if (alerted < MAX_PROMOTION_ALERTS_PER_RUN) {
            await store.createAlert(
              competitor.tenantId,
              formatPromotionAlert(competitor.name, promotion.promotionText)
            );
            summary.alertsCreated += 1;
            alerted += 1;
          }
        }
      }
    } catch (err) {
      summary.skipped.promotionFailed += 1;
      console.error(`[MarketTracking] Promotion scan failed for competitor ${competitor.id}`, err);
    }

    if (summary.samples.length < 5) summary.samples.push(sample);
  }

  return summary;
}
