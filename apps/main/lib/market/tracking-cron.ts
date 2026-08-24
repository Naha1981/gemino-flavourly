import { compareMenus, scrapeMenu, type MenuItem, type ScrapedMenu } from './menu-scraper.ts';
import { detectPromotions, type DetectedPromotion } from './promotion-detector.ts';
import { formatMenuChangeAlert, formatPromotionAlert } from './competitor-alerts.ts';

/**
 * Gate #16 — competitor tracking cron runner, framework-free.
 *
 * One run, per tracked competitor with a website:
 *   1. scrape the menu; diff against the latest stored snapshot
 *        - no snapshot yet  -> store the baseline, NO alert (a first read
 *          is not a change)
 *        - has changes      -> store the snapshot + raise a menu alert
 *        - unchanged        -> nothing (no snapshot spam)
 *   2. scan for promotions; any promotion whose fingerprint is not in the
 *      recent window is NEW -> store it + raise a promotion alert
 *
 * A failed fetch is counted per competitor and never aborts the sweep.
 */

export interface TrackedCompetitor {
  id: string;
  tenantId: string;
  name: string;
  websiteUrl: string;
}

export interface TrackingStore {
  /** Platform-wide: every tracked place with a website (cron-only seam). */
  findCompetitorsWithWebsites(): Promise<TrackedCompetitor[]>;
  getLatestMenuSnapshot(competitorId: string): Promise<{ items: MenuItem[] } | null>;
  saveMenuSnapshot(input: {
    competitorId: string;
    menuUrl: string | null;
    menuText: string | null;
    items: MenuItem[];
    priceRange: string | null;
    snapshotAt: Date;
  }): Promise<void>;
  getRecentPromotionKeys(competitorId: string, days: number): Promise<Set<string>>;
  savePromotion(input: {
    competitorId: string;
    promotionText: string;
    promotionKey: string;
    source: string;
    detectedAt: Date;
  }): Promise<void>;
  createAlert(tenantId: string, text: string): Promise<void>;
}

export interface TrackingOptions {
  now?: Date;
  fetchImpl?: typeof fetch;
  scrapeFn?: typeof scrapeMenu;
  detectFn?: typeof detectPromotions;
  /** Promotion-dedup window in days (default 30). */
  promotionWindowDays?: number;
  limit?: number;
}

export interface TrackingSummary {
  competitorsChecked: number;
  menuScraped: number;
  snapshotsSaved: number;
  menuAlerts: number;
  promotionsScanned: number;
  promotionsSaved: number;
  promotionAlerts: number;
  skipped: { scrapeFailed: number; detectFailed: number; failed: number };
  samples: Array<{ competitorId: string; name: string; kind: 'menu' | 'promotion'; text: string }>;
}

const DEFAULT_LIMIT = 200;
const DEFAULT_PROMOTION_WINDOW_DAYS = 30;

function positiveLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_LIMIT;
}

export async function runCompetitorTrackingCron(
  store: TrackingStore,
  options: TrackingOptions = {}
): Promise<TrackingSummary> {
  const now = options.now ?? new Date();
  const doScrape = options.scrapeFn ?? scrapeMenu;
  const doDetect = options.detectFn ?? detectPromotions;
  const windowDays = options.promotionWindowDays ?? DEFAULT_PROMOTION_WINDOW_DAYS;

  const summary: TrackingSummary = {
    competitorsChecked: 0,
    menuScraped: 0,
    snapshotsSaved: 0,
    menuAlerts: 0,
    promotionsScanned: 0,
    promotionsSaved: 0,
    promotionAlerts: 0,
    skipped: { scrapeFailed: 0, detectFailed: 0, failed: 0 },
    samples: [],
  };

  let competitors: TrackedCompetitor[] = [];
  try {
    competitors = await store.findCompetitorsWithWebsites();
  } catch (err) {
    console.error('[Tracking] Failed to load competitors', err);
    summary.skipped.failed += 1;
    return summary;
  }

  for (const competitor of competitors) {
    if (summary.competitorsChecked >= positiveLimit(options.limit)) break;
    summary.competitorsChecked += 1;

    // ---- 1. Menu scrape + diff ------------------------------------------
    let menu: ScrapedMenu | null = null;
    try {
      menu = await doScrape(competitor.websiteUrl, { fetchImpl: options.fetchImpl });
      summary.menuScraped += 1;
    } catch (err) {
      console.error(`[Tracking] Menu scrape failed for ${competitor.name}`, err);
      summary.skipped.scrapeFailed += 1;
    }

    if (menu) {
      try {
        const latest = await store.getLatestMenuSnapshot(competitor.id);
        if (!latest) {
          // Baseline: record, never alert (a first read is not a change).
          await store.saveMenuSnapshot({
            competitorId: competitor.id,
            menuUrl: menu.menuUrl,
            menuText: menu.menuText,
            items: menu.items,
            priceRange: menu.priceRange,
            snapshotAt: now,
          });
          summary.snapshotsSaved += 1;
        } else {
          const diff = compareMenus(latest.items, menu.items);
          if (diff.hasChanges) {
            await store.saveMenuSnapshot({
              competitorId: competitor.id,
              menuUrl: menu.menuUrl,
              menuText: menu.menuText,
              items: menu.items,
              priceRange: menu.priceRange,
              snapshotAt: now,
            });
            summary.snapshotsSaved += 1;

            const alertText = formatMenuChangeAlert(competitor.name, diff);
            await store.createAlert(competitor.tenantId, alertText);
            summary.menuAlerts += 1;
            if (summary.samples.length < 5) {
              summary.samples.push({ competitorId: competitor.id, name: competitor.name, kind: 'menu', text: alertText });
            }
          }
        }
      } catch (err) {
        console.error(`[Tracking] Menu diff/store failed for ${competitor.name}`, err);
        summary.skipped.failed += 1;
      }
    }

    // ---- 2. Promotion scan ----------------------------------------------
    let promotions: DetectedPromotion[] = [];
    try {
      promotions = await doDetect(competitor.websiteUrl, { fetchImpl: options.fetchImpl });
      summary.promotionsScanned += 1;
    } catch (err) {
      console.error(`[Tracking] Promotion scan failed for ${competitor.name}`, err);
      summary.skipped.detectFailed += 1;
    }

    if (promotions.length > 0) {
      try {
        const known = await store.getRecentPromotionKeys(competitor.id, windowDays);
        for (const promotion of promotions) {
          if (known.has(promotion.promotionKey)) continue; // not new
          await store.savePromotion({
            competitorId: competitor.id,
            promotionText: promotion.promotionText,
            promotionKey: promotion.promotionKey,
            source: 'website',
            detectedAt: now,
          });
          summary.promotionsSaved += 1;

          const alertText = formatPromotionAlert(competitor.name, promotion.promotionText);
          await store.createAlert(competitor.tenantId, alertText);
          summary.promotionAlerts += 1;
          if (summary.samples.length < 5) {
            summary.samples.push({
              competitorId: competitor.id,
              name: competitor.name,
              kind: 'promotion',
              text: alertText,
            });
          }
        }
      } catch (err) {
        console.error(`[Tracking] Promotion store failed for ${competitor.name}`, err);
        summary.skipped.failed += 1;
      }
    }
  }

  return summary;
}
