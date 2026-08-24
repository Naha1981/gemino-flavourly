import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { runCompetitorTrackingCron, type TrackingStore } from '@/lib/market/tracking-cron';
import {
  findCompetitorsWithWebsites,
  getLatestMenuSnapshot,
  getRecentPromotionKeys,
  saveMenuSnapshot,
  savePromotion,
} from '@/lib/market/competitor-store';
import { insertSystemAlert } from '@/lib/reputation/competitor-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One website fetch (menu) + one (promotions) per tracked competitor,
// platform-wide.
export const maxDuration = 120;

/**
 * Gate #16 — daily competitor tracking sweep (08:00 SAST via cron-job.org).
 * Scrapes competitor websites for menu/price changes and new promotions,
 * stores snapshots, and raises staff-facing alerts in the tenant's inbox.
 */
const cronStore: TrackingStore = {
  // SQL already filters to non-empty website_url; narrow the row shape.
  findCompetitorsWithWebsites: async () =>
    (await findCompetitorsWithWebsites()).map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      websiteUrl: row.websiteUrl as string,
    })),
  // jsonb menu_items comes back unknown; coerce to the diff's item shape.
  getLatestMenuSnapshot: async (competitorId) => {
    const snapshot = await getLatestMenuSnapshot(competitorId);
    if (!snapshot) return null;
    const items = Array.isArray(snapshot.menuItems)
      ? (snapshot.menuItems as Array<{ name?: unknown; priceCents?: unknown }>)
          .filter((item) => typeof item?.name === 'string' && typeof item?.priceCents === 'number')
          .map((item) => ({ name: item.name as string, priceCents: item.priceCents as number }))
      : [];
    return { items };
  },
  saveMenuSnapshot: (input) =>
    saveMenuSnapshot({
      competitorId: input.competitorId,
      menuUrl: input.menuUrl,
      menuText: input.menuText,
      menuItems: input.items,
      priceRange: input.priceRange,
      snapshotAt: input.snapshotAt,
    }).then(() => undefined),
  getRecentPromotionKeys,
  savePromotion: (input) =>
    savePromotion({
      competitorId: input.competitorId,
      promotionText: input.promotionText,
      promotionKey: input.promotionKey,
      source: input.source,
      detectedAt: input.detectedAt,
    }).then(() => undefined),
  createAlert: insertSystemAlert,
};

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', snapshotsSaved: 0 });
  }

  const summary = await runCompetitorTrackingCron(cronStore, { now: new Date() });

  console.log(
    `[Tracking] competitors=${summary.competitorsChecked} menus=${summary.menuScraped} ` +
      `snapshots=${summary.snapshotsSaved} menuAlerts=${summary.menuAlerts} ` +
      `promotions=${summary.promotionsSaved} promoAlerts=${summary.promotionAlerts} ` +
      `scrapeFailed=${summary.skipped.scrapeFailed} detectFailed=${summary.skipped.detectFailed}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
