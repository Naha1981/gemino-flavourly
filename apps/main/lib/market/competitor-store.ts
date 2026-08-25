import { and, asc, desc, eq, gte, isNotNull, like, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  competitorMenuSnapshots,
  competitorPromotions,
  competitors,
  googlePlacesConfig,
  messages,
  tenants,
} from '@/lib/db/schema';
import { MARKET_ALERT_PREFIX, type CompetitorTrackingStore } from './competitor-alerts.ts';
import {
  insertSystemAlert,
} from '@/lib/reputation/competitor-store';

/**
 * Gates #15-#17 — Drizzle adapter for the market-intelligence tables.
 *
 * Same shape as the Gate #14 reputation store: pure logic lives in the
 * framework-free modules next door, this file only talks to Postgres.
 *
 * Tenant scoping: every read/write takes tenantId EXCEPT the four functions
 * that deliberately cross tenants, and those are labelled at the call site —
 *   - findTrackedCompetitors: the daily tracking cron sweeps the platform
 *   - countAllMarketCompetitors / countMarketAlertsThisWeek: Super Admin KPIs
 *   - insertMarketAlert: inserts INTO one tenant's stream (scoped by its arg)
 *
 * neon-http has no interactive transactions, so multi-statement helpers run
 * sequentially and are written to be safe to re-run: menu snapshots and
 * promotions are append-only rows keyed by time, so a crash between two
 * statements leaves a duplicate at worst, never a corrupt row.
 */

export type MarketCompetitorRow = typeof competitors.$inferSelect;
export type MenuSnapshotRow = typeof competitorMenuSnapshots.$inferSelect;
export type PromotionRow = typeof competitorPromotions.$inferSelect;

/** Fields a competitor row can be created/updated with. */
export interface CompetitorInput {
  name?: string;
  address?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  distanceKm?: string | number | null;
  googlePlaceId?: string | null;
  websiteUrl?: string | null;
  phone?: string | null;
}

/**
 * numeric() columns must be written as strings (Drizzle maps them to text on
 * the way in). Anything not a finite number becomes NULL rather than '0' —
 * a competitor 0.0km away and one with unknown distance are different facts.
 */
function numericOrNull(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? String(parsed) : null;
}

function cleanText(value: string | null | undefined, max = 2000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Insert a competitor. `name` is the only required field. */
export async function createCompetitor(
  tenantId: string,
  data: CompetitorInput
): Promise<MarketCompetitorRow> {
  const [row] = await db
    .insert(competitors)
    .values({
      tenantId,
      name: cleanText(data.name, 160) ?? 'Unnamed competitor',
      address: cleanText(data.address, 500),
      latitude: numericOrNull(data.latitude),
      longitude: numericOrNull(data.longitude),
      distanceKm: numericOrNull(data.distanceKm),
      googlePlaceId: cleanText(data.googlePlaceId, 256),
      websiteUrl: cleanText(data.websiteUrl, 500),
      phone: cleanText(data.phone, 64),
    })
    .returning();
  return row;
}

/**
 * Update a competitor. Tenant-scoped: a leaked uuid from another tenant
 * updates nothing and returns null, which the caller turns into a 404.
 * Only keys present in `data` are touched, so a partial refresh (e.g. the
 * tracking cron storing a website it just discovered) cannot blank the rest.
 */
export async function updateCompetitor(
  tenantId: string,
  competitorId: string,
  data: CompetitorInput
): Promise<MarketCompetitorRow | null> {
  const patch: Partial<typeof competitors.$inferInsert> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = cleanText(data.name, 160) ?? 'Unnamed competitor';
  if (data.address !== undefined) patch.address = cleanText(data.address, 500);
  if (data.latitude !== undefined) patch.latitude = numericOrNull(data.latitude);
  if (data.longitude !== undefined) patch.longitude = numericOrNull(data.longitude);
  if (data.distanceKm !== undefined) patch.distanceKm = numericOrNull(data.distanceKm);
  if (data.googlePlaceId !== undefined) patch.googlePlaceId = cleanText(data.googlePlaceId, 256);
  if (data.websiteUrl !== undefined) patch.websiteUrl = cleanText(data.websiteUrl, 500);
  if (data.phone !== undefined) patch.phone = cleanText(data.phone, 64);

  const [row] = await db
    .update(competitors)
    .set(patch)
    .where(and(eq(competitors.tenantId, tenantId), eq(competitors.id, competitorId)))
    .returning();
  return row ?? null;
}

/** Tenant-scoped single read (the dashboard detail panel). */
export async function getCompetitor(
  tenantId: string,
  competitorId: string
): Promise<MarketCompetitorRow | null> {
  const [row] = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.tenantId, tenantId), eq(competitors.id, competitorId)))
    .limit(1);
  return row ?? null;
}

/**
 * All competitors for a tenant, nearest first. Rows with no distance
 * (hand-added without an address) sort last rather than interleaving as 0.
 */
export async function listCompetitors(tenantId: string): Promise<MarketCompetitorRow[]> {
  return db
    .select()
    .from(competitors)
    .where(eq(competitors.tenantId, tenantId))
    .orderBy(
      asc(sql`CASE WHEN ${competitors.distanceKm} IS NULL THEN 1 ELSE 0 END`),
      asc(competitors.distanceKm),
      asc(competitors.name)
    );
}

// -----------------------------------------------------------------------------
// Menu snapshots (#16)
// -----------------------------------------------------------------------------

/** Append a menu snapshot. Append-only: the timeline IS the change history. */
export async function saveMenuSnapshot(
  competitorId: string,
  menuUrl: string | null,
  menuText: string | null,
  priceRange: string | null
): Promise<MenuSnapshotRow> {
  const [row] = await db
    .insert(competitorMenuSnapshots)
    .values({
      competitorId,
      menuUrl: cleanText(menuUrl, 500),
      menuText: cleanText(menuText, 60_000),
      priceRange: cleanText(priceRange, 120),
    })
    .returning();
  return row;
}

/** The newest snapshot — the baseline the tracker diffs the next scrape against. */
export async function getLatestMenuSnapshot(competitorId: string): Promise<MenuSnapshotRow | null> {
  const [row] = await db
    .select()
    .from(competitorMenuSnapshots)
    .where(eq(competitorMenuSnapshots.competitorId, competitorId))
    .orderBy(desc(competitorMenuSnapshots.snapshotAt))
    .limit(1);
  return row ?? null;
}

/**
 * A competitor's whole snapshot timeline, newest first. Scoped through the
 * competitor row, so a leaked snapshot/competitor uuid cannot read another
 * tenant's menu history.
 */
export async function listMenuSnapshots(
  tenantId: string,
  competitorId: string,
  limit = 50
): Promise<MenuSnapshotRow[]> {
  const owner = await getCompetitor(tenantId, competitorId);
  if (!owner) return [];
  return db
    .select()
    .from(competitorMenuSnapshots)
    .where(eq(competitorMenuSnapshots.competitorId, competitorId))
    .orderBy(desc(competitorMenuSnapshots.snapshotAt))
    .limit(Math.max(1, Math.min(limit, 200)));
}

// -----------------------------------------------------------------------------
// Promotions (#16)
// -----------------------------------------------------------------------------

/** Record a detected promotion. */
export async function savePromotion(
  competitorId: string,
  promotionText: string,
  source: string | null
): Promise<PromotionRow> {
  const [row] = await db
    .insert(competitorPromotions)
    .values({
      competitorId,
      promotionText: cleanText(promotionText, 1000) ?? '',
      source: cleanText(source, 200),
    })
    .returning();
  return row;
}

/** Promotions detected in the last N days, newest first (dedup window). */
export async function getRecentPromotions(
  competitorId: string,
  days = 30
): Promise<PromotionRow[]> {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(competitorPromotions)
    .where(
      and(
        eq(competitorPromotions.competitorId, competitorId),
        gte(competitorPromotions.detectedAt, since)
      )
    )
    .orderBy(desc(competitorPromotions.detectedAt));
}

/** A competitor's full promotion timeline (dashboard), tenant-scoped. */
export async function listPromotions(
  tenantId: string,
  competitorId: string,
  limit = 50
): Promise<PromotionRow[]> {
  const owner = await getCompetitor(tenantId, competitorId);
  if (!owner) return [];
  return db
    .select()
    .from(competitorPromotions)
    .where(eq(competitorPromotions.competitorId, competitorId))
    .orderBy(desc(competitorPromotions.detectedAt))
    .limit(Math.max(1, Math.min(limit, 200)));
}

// -----------------------------------------------------------------------------
// Discovery helpers (#15)
// -----------------------------------------------------------------------------

/**
 * The place ids a tenant already tracks, plus its OWN Google place. Discovery
 * skips all of them: re-adding a competitor would duplicate the row, and
 * tracking your own restaurant as a competitor is a bug, not a feature.
 */
export async function knownPlaceIds(tenantId: string): Promise<Set<string>> {
  const [existing, ownConfig] = await Promise.all([
    db
      .select({ placeId: competitors.googlePlaceId })
      .from(competitors)
      .where(eq(competitors.tenantId, tenantId)),
    db
      .select({ placeId: googlePlacesConfig.placeId })
      .from(googlePlacesConfig)
      .where(eq(googlePlacesConfig.tenantId, tenantId))
      .limit(1),
  ]);

  const ids = new Set<string>();
  for (const row of existing) if (row.placeId) ids.add(row.placeId);
  if (ownConfig[0]?.placeId) ids.add(ownConfig[0].placeId);
  return ids;
}

/** Remember where the tenant is, so the next discovery is one click. */
export async function saveTenantLocation(
  tenantId: string,
  input: { address: string | null; latitude: number; longitude: number }
): Promise<void> {
  await db
    .update(tenants)
    .set({
      address: cleanText(input.address, 500),
      latitude: numericOrNull(input.latitude),
      longitude: numericOrNull(input.longitude),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
}

// -----------------------------------------------------------------------------
// Tracking cron input (#16)
// -----------------------------------------------------------------------------

/**
 * Every competitor platform-wide that HAS a website to scrape. Deliberately
 * unscoped: the daily cron is a platform sweep, and a competitor with no
 * website_url has nothing for the scraper to fetch.
 */
export async function findTrackedCompetitors(limit = 200): Promise<MarketCompetitorRow[]> {
  return db
    .select()
    .from(competitors)
    .where(isNotNull(competitors.websiteUrl))
    .orderBy(asc(competitors.createdAt))
    .limit(Math.max(1, Math.min(limit, 1000)));
}

/**
 * Remember the /menu URL the scraper actually read, so tomorrow's run goes
 * straight there instead of re-following the link. Keyed by id (not tenant)
 * because only the platform cron calls it, for a row it just read.
 */
export async function saveDiscoveredMenuUrl(competitorId: string, menuUrl: string): Promise<void> {
  await db
    .update(competitors)
    .set({ websiteUrl: cleanText(menuUrl, 500), updatedAt: new Date() })
    .where(eq(competitors.id, competitorId));
}

/**
 * The cron-facing adapter satisfying competitor-alerts.ts's store contract,
 * wiring the framework-free runner to these Drizzle helpers.
 */
export const drizzleMarketTrackingStore: CompetitorTrackingStore = {
  findTrackedCompetitors: async () =>
    (await findTrackedCompetitors()).map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      websiteUrl: row.websiteUrl,
    })),
  getLatestMenuSnapshot,
  saveMenuSnapshot: async (competitorId, menuUrl, menuText, priceRange) => {
    await saveMenuSnapshot(competitorId, menuUrl, menuText, priceRange);
  },
  getRecentPromotions,
  savePromotion: async (competitorId, promotionText, source) => {
    await savePromotion(competitorId, promotionText, source);
  },
  createAlert: insertMarketAlert,
  saveDiscoveredMenuUrl,
};

// -----------------------------------------------------------------------------
// Alerts (#16) — system messages in the tenant's inbox
// -----------------------------------------------------------------------------

/**
 * Surface a market alert in the tenant's system-alerts thread. The thread
 * itself (synthetic contact + conversation, direction 'system', never
 * dispatched) is owned by lib/reputation/competitor-store — imported rather
 * than re-implemented so there is exactly one definition of "staff inbox".
 */
export async function insertMarketAlert(tenantId: string, text: string): Promise<void> {
  await insertSystemAlert(tenantId, text);
}

/** This tenant's market alerts from the last N days (dashboard banner). */
export async function recentMarketAlerts(tenantId: string, days = 7): Promise<string[]> {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ content: messages.content })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.direction, 'system'),
        like(messages.content, `${MARKET_ALERT_PREFIX}%`),
        gte(messages.createdAt, since)
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(50);
  return rows.map((row) => row.content);
}

// -----------------------------------------------------------------------------
// Super Admin platform metrics (#18 admin extension)
// -----------------------------------------------------------------------------

/** Total competitors tracked across all tenants (rating + market). */
export async function countAllMarketCompetitors(): Promise<number> {
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(competitors);
  return Number(row?.value ?? 0);
}

/** Menu-change + promotion alerts raised in the last 7 days, platform-wide. */
export async function countMarketAlertsThisWeek(): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.direction, 'system'),
        like(messages.content, `${MARKET_ALERT_PREFIX}%`),
        gte(messages.createdAt, since)
      )
    );
  return Number(row?.value ?? 0);
}
