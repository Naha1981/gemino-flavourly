import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { runCompetitorTrackingCron } from '@/lib/market/competitor-alerts';
import { drizzleMarketTrackingStore } from '@/lib/market/competitor-store';
import { itemsFromText, menuSnapshotText, scrapeMenu } from '@/lib/market/menu-scraper';
import { detectPromotions, newPromotions } from '@/lib/market/promotion-detector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Two HTTP fetches per competitor (menu page + promotion scan of the same
// page). 60s is the ceiling on the platform this deploys to, so the sweep is
// bounded by `limit` below rather than by the clock: a partial run is safe
// because every write is append-only and idempotent per competitor.
export const maxDuration = 60;

/** Ceiling per run; the rest is picked up tomorrow (list is oldest-first). */
const COMPETITORS_PER_RUN = 40;

/**
 * Gate #16 — daily competitor menu/price/promotion sweep.
 *
 * Schedule it on cron-job.org at 08:00 with:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Guarded like every cron route. The master AI switch is honoured too, even
 * though this sweep calls no model: it is the platform's single "stop all
 * automation" control, and a tenant who flipped it off does not want their
 * app fetching third-party websites on a schedule either.
 *
 * All the logic lives in lib/market/competitor-alerts.ts's framework-free
 * runner; this handler only authorizes, wires the real implementations in,
 * and reports the summary.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', competitorsChecked: 0 });
  }

  const summary = await runCompetitorTrackingCron(
    drizzleMarketTrackingStore,
    {
      scrapeMenuFn: scrapeMenu,
      detectPromotionsFn: detectPromotions,
      menuSnapshotTextFn: menuSnapshotText,
      itemsFromTextFn: itemsFromText,
      newPromotionsFn: newPromotions,
    },
    { now: new Date(), limit: COMPETITORS_PER_RUN }
  );

  console.log(
    `[MarketTracking] checked=${summary.competitorsChecked} scraped=${summary.menusScraped} ` +
      `baselines=${summary.baselinesSaved} menuChanges=${summary.menuChangesDetected} ` +
      `newPromos=${summary.newPromotionsSaved} alerts=${summary.alertsCreated} ` +
      `scrapeFailed=${summary.skipped.scrapeFailed} promoFailed=${summary.skipped.promotionFailed} ` +
      `noMenuItems=${summary.skipped.noMenuItems}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
