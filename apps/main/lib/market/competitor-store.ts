import { and, asc, desc, eq, gte, like, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  competitorMenuSnapshots,
  competitorPromotions,
  competitors,
  messages,
} from '@/lib/db/schema';

/**
 * Gate #15/#16 — Drizzle adapter for competitor discovery + tracking.
 *
 * The `competitors` table is shared with the reputation engine (Gate #14):
 * that engine owns rating monitoring, this engine owns discovery metadata
 * (address/geo/website/phone) and menu/promotion tracking. Both scopes are
 * tenant-isolated; the cron-facing listing (`findCompetitorsWithWebsites`)
 * is deliberately platform-wide, like the Gate #14 sweep.
 */

export type MarketCompetitorRow = typeof competitors.$inferSelect;
export type MenuSnapshotRow = typeof competitorMenuSnapshots.$inferSelect;
export type PromotionRow = typeof competitorPromotions.$inferSelect;

export interface UpsertCompetitorInput {
  name: string;
  googlePlaceId: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distanceKm?: number | null;
  rating?: number | null;
  priceLevel?: number | null;
  websiteUrl?: string | null;
  phone?: string | null;
  isSelf?: boolean;
}

/**
 * Insert or refresh a discovered competitor. Keyed on the unique
 * (tenant_id, google_place_id): re-running discovery updates the row's
 * discovery metadata instead of duplicating it. Manual adds with a new
 * place id create fresh rows. Returns which happened.
 */
export async function upsertCompetitor(
  tenantId: string,
  input: UpsertCompetitorInput
): Promise<{ row: MarketCompetitorRow; inserted: boolean }> {
  const [existing] = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(and(eq(competitors.tenantId, tenantId), eq(competitors.googlePlaceId, input.googlePlaceId)))
    .limit(1);

  const discoveryOwned = {
    name: input.name,
    address: input.address ?? null,
    latitude: input.latitude != null ? String(input.latitude) : null,
    longitude: input.longitude != null ? String(input.longitude) : null,
    distanceKm: input.distanceKm != null ? String(input.distanceKm) : null,
    rating: input.rating != null ? String(input.rating) : null,
    priceLevel: input.priceLevel != null ? `PRICE_LEVEL_${input.priceLevel}` : null,
    websiteUrl: input.websiteUrl ?? null,
    phone: input.phone ?? null,
    isSelf: input.isSelf ?? false,
    updatedAt: new Date(),
  };

  if (existing) {
    const [row] = await db.update(competitors).set(discoveryOwned).where(eq(competitors.id, existing.id)).returning();
    return { row, inserted: false };
  }

  try {
    const [row] = await db
      .insert(competitors)
      .values({ tenantId, googlePlaceId: input.googlePlaceId, ...discoveryOwned })
      .returning();
    return { row, inserted: true };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      const [row] = await db
        .update(competitors)
        .set(discoveryOwned)
        .where(and(eq(competitors.tenantId, tenantId), eq(competitors.googlePlaceId, input.googlePlaceId)))
        .returning();
      if (row) return { row, inserted: false };
    }
    throw err;
  }
}

/** Update manually-editable details (website etc.) — tenant-scoped. */
export async function updateCompetitor(
  tenantId: string,
  competitorId: string,
  data: Partial<Pick<UpsertCompetitorInput, 'name' | 'address' | 'websiteUrl' | 'phone'>>
): Promise<MarketCompetitorRow | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.address !== undefined) patch.address = data.address;
  if (data.websiteUrl !== undefined) patch.websiteUrl = data.websiteUrl;
  if (data.phone !== undefined) patch.phone = data.phone;

  const [row] = await db
    .update(competitors)
    .set(patch)
    .where(and(eq(competitors.tenantId, tenantId), eq(competitors.id, competitorId)))
    .returning();
  return row ?? null;
}

/**
 * The tenant's tracked places, closest first (null distances last).
 * `includeSelf` adds the tenant's own row (positioning needs it; the
 * competitor list does not).
 */
export async function listCompetitors(
  tenantId: string,
  options: { includeSelf?: boolean } = {}
): Promise<MarketCompetitorRow[]> {
  const conditions = [eq(competitors.tenantId, tenantId)];
  if (!options.includeSelf) conditions.push(eq(competitors.isSelf, false));
  return db
    .select()
    .from(competitors)
    .where(and(...conditions))
    .orderBy(sql`${competitors.distanceKm} ASC NULLS LAST`, desc(competitors.createdAt));
}

/** The tenant's own row (is_self), created by discovery when it matches the
 *  tenant's configured Google place. Positioning (Gate #18) reads it. */
export async function getSelfCompetitor(tenantId: string): Promise<MarketCompetitorRow | null> {
  const [row] = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.tenantId, tenantId), eq(competitors.isSelf, true)))
    .limit(1);
  return row ?? null;
}

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

/** Platform-wide listing of competitors with a website (tracking cron). */
export async function findCompetitorsWithWebsites(): Promise<MarketCompetitorRow[]> {
  return db
    .select()
    .from(competitors)
    .where(and(sql`${competitors.websiteUrl} IS NOT NULL`, ne(competitors.websiteUrl, '')))
    .orderBy(asc(competitors.createdAt));
}

// -----------------------------------------------------------------------------
// Menu snapshots (Gate #16)
// -----------------------------------------------------------------------------

export async function saveMenuSnapshot(input: {
  competitorId: string;
  menuUrl: string | null;
  menuText: string | null;
  menuItems: unknown;
  priceRange: string | null;
  snapshotAt?: Date;
}): Promise<MenuSnapshotRow> {
  const [row] = await db
    .insert(competitorMenuSnapshots)
    .values({
      competitorId: input.competitorId,
      menuUrl: input.menuUrl,
      menuText: input.menuText,
      menuItems: (input.menuItems as object[]) ?? [],
      priceRange: input.priceRange,
      snapshotAt: input.snapshotAt ?? new Date(),
    })
    .returning();
  return row;
}

export async function getLatestMenuSnapshot(competitorId: string): Promise<MenuSnapshotRow | null> {
  const [row] = await db
    .select()
    .from(competitorMenuSnapshots)
    .where(eq(competitorMenuSnapshots.competitorId, competitorId))
    .orderBy(desc(competitorMenuSnapshots.snapshotAt))
    .limit(1);
  return row ?? null;
}

/** Full snapshot history for one competitor, newest first (tenant-gated by
 *  the caller resolving the competitor row through listCompetitors). */
export async function getMenuHistory(
  tenantId: string,
  competitorId: string
): Promise<MenuSnapshotRow[]> {
  // Scope through the competitor row so a foreign uuid sees nothing.
  const owner = await getCompetitor(tenantId, competitorId);
  if (!owner) return [];
  return db
    .select()
    .from(competitorMenuSnapshots)
    .where(eq(competitorMenuSnapshots.competitorId, competitorId))
    .orderBy(desc(competitorMenuSnapshots.snapshotAt))
    .limit(60);
}

// -----------------------------------------------------------------------------
// Promotions (Gate #16)
// -----------------------------------------------------------------------------

export async function savePromotion(input: {
  competitorId: string;
  promotionText: string;
  promotionKey: string;
  source: string | null;
  detectedAt?: Date;
}): Promise<PromotionRow> {
  const [row] = await db
    .insert(competitorPromotions)
    .values({
      competitorId: input.competitorId,
      promotionText: input.promotionText,
      promotionKey: input.promotionKey,
      source: input.source,
      detectedAt: input.detectedAt ?? new Date(),
    })
    .returning();
  return row;
}

export async function getRecentPromotions(competitorId: string, days = 30): Promise<PromotionRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(competitorPromotions)
    .where(
      and(eq(competitorPromotions.competitorId, competitorId), gte(competitorPromotions.detectedAt, since))
    )
    .orderBy(desc(competitorPromotions.detectedAt));
}

/** Promotion keys seen recently for a competitor (the "is this NEW?" check). */
export async function getRecentPromotionKeys(competitorId: string, days = 30): Promise<Set<string>> {
  const rows = await getRecentPromotions(competitorId, days);
  return new Set(rows.map((row) => row.promotionKey));
}

/** All promotions for one competitor, tenant-gated (dashboard timeline). */
export async function listPromotionsForCompetitor(
  tenantId: string,
  competitorId: string,
  days = 90
): Promise<PromotionRow[]> {
  const owner = await getCompetitor(tenantId, competitorId);
  if (!owner) return [];
  return getRecentPromotions(competitorId, days);
}

// -----------------------------------------------------------------------------
// Alerts (Gate #16) — system messages, prefix-identified for metrics
// -----------------------------------------------------------------------------

export const MARKET_ALERT_PREFIX = '⚠️ Market Alert:';

/** Recent market-tracking alerts (menu changes + promotions), last N days. */
export async function recentMarketAlerts(tenantId: string, days = 30): Promise<string[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
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

/** Platform metric: market alerts raised this week, all tenants. */
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

// Aliases used by the tracking cron's store interface.
export { competitors as competitorsTable };
