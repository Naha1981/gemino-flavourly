import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { competitors, marketOpportunities, tenants } from '@/lib/db/schema';
import {
  analyzeOpportunities,
  priceRangeFromString,
  type CompetitorOffering,
  type Opportunity,
  type TenantOffering,
} from './opportunity-analyzer.ts';
import { itemsFromText, parseMenuItems } from './menu-scraper.ts';
import { latestSnapshotsByCompetitor, listCompetitors, type PlaceData } from './competitor-store.ts';

/**
 * Gate #17 — persistence for market opportunities.
 *
 * The analyzer is pure; this module is the only thing that touches Postgres.
 * Everything is tenant-scoped except countAllOpportunities, which is a Super
 * Admin platform KPI and says so at the call site.
 *
 * The upsert key is (tenant_id, key): re-running the analysis REFRESHES a
 * known gap (new confidence, new evidence) instead of inserting a second row,
 * and — critically — never clears `addressed`, because an opportunity the
 * owner already acted on must stay marked.
 */

export type MarketOpportunityRow = typeof marketOpportunities.$inferSelect;

/** Insert or refresh a batch. Returns how many rows were written. */
export async function saveOpportunities(
  tenantId: string,
  opportunities: Opportunity[]
): Promise<{ upserted: number }> {
  if (opportunities.length === 0) return { upserted: 0 };

  for (const opportunity of opportunities) {
    await db
      .insert(marketOpportunities)
      .values({
        tenantId,
        key: opportunity.key,
        opportunityType: opportunity.opportunityType,
        title: opportunity.title,
        description: opportunity.description,
        confidence: opportunity.confidence.toFixed(2),
        evidence: opportunity.evidence,
      })
      .onConflictDoUpdate({
        target: [marketOpportunities.tenantId, marketOpportunities.key],
        // `addressed` / `addressedAt` are deliberately absent: the analyzer
        // has no opinion on what the owner has already done about a gap.
        set: {
          opportunityType: opportunity.opportunityType,
          title: opportunity.title,
          description: opportunity.description,
          confidence: opportunity.confidence.toFixed(2),
          evidence: opportunity.evidence,
          updatedAt: new Date(),
        },
      });
  }
  return { upserted: opportunities.length };
}

/** All opportunities for a tenant, best first. */
export async function getOpportunities(tenantId: string): Promise<MarketOpportunityRow[]> {
  return db
    .select()
    .from(marketOpportunities)
    .where(eq(marketOpportunities.tenantId, tenantId))
    .orderBy(desc(marketOpportunities.confidence), desc(marketOpportunities.detectedAt));
}

/**
 * Mark an opportunity as addressed (or un-mark it). Tenant-scoped, so another
 * tenant's uuid updates nothing and reads as 404.
 */
export async function markAddressed(
  tenantId: string,
  opportunityId: string,
  addressed = true
): Promise<boolean> {
  const [row] = await db
    .update(marketOpportunities)
    .set({ addressed, addressedAt: addressed ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(marketOpportunities.tenantId, tenantId), eq(marketOpportunities.id, opportunityId)))
    .returning({ id: marketOpportunities.id });
  return Boolean(row);
}

/** Total opportunities detected across all tenants (Super Admin KPI). */
export async function countAllOpportunities(): Promise<number> {
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(marketOpportunities);
  return Number(row?.value ?? 0);
}

// -----------------------------------------------------------------------------
// Building the analyzer input from stored data
// -----------------------------------------------------------------------------

/**
 * One CompetitorOffering per tracked competitor, assembled from the row plus
 * its newest menu snapshot. A competitor that has not been scraped yet still
 * contributes its Google place types, which is real (if thinner) evidence.
 */
export async function collectCompetitorOfferings(tenantId: string): Promise<CompetitorOffering[]> {
  const [rows, snapshots] = await Promise.all([
    listCompetitors(tenantId),
    latestSnapshotsByCompetitor(tenantId),
  ]);

  return rows.map((row) => {
    const snapshot = snapshots.get(row.id) ?? null;
    const place = (row.placeData ?? {}) as PlaceData;
    return {
      id: row.id,
      name: row.name,
      distanceKm: row.distanceKm === null ? null : Number(row.distanceKm),
      menuText: snapshot?.menuText ?? null,
      menuItems: itemsFromText(snapshot?.menuText ?? null),
      priceRange: priceRangeFromString(snapshot?.priceRange ?? null),
      placeTypes: Array.isArray(place.types) ? place.types : [],
      serves: Array.isArray(place.serves) ? place.serves : [],
      priceLevel: typeof place.priceLevel === 'number' ? place.priceLevel : null,
      rating: Number(row.currentRating) > 0 ? Number(row.currentRating) : null,
    };
  });
}

/** The tenant's own offering, read from the columns the owner can edit. */
export async function collectTenantOffering(tenantId: string): Promise<TenantOffering> {
  const [row] = await db
    .select({
      name: tenants.name,
      menuText: tenants.menuText,
      openingHours: tenants.openingHours,
      description: tenants.description,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const menuText = row?.menuText?.trim() || row?.description?.trim() || null;
  return {
    name: row?.name ?? 'Your restaurant',
    menuText,
    menuItems: menuText ? parseMenuItems(menuText) : [],
    // The tenant's Google place types are not stored anywhere, so cuisine
    // detection for the tenant falls back to its menu text. That is the
    // honest answer rather than a guessed type list.
    placeTypes: [],
    serves: [],
    openingHours: row?.openingHours ?? null,
    priceLevel: null,
  };
}

/**
 * Platform-wide refresh: every tenant that tracks at least one competitor.
 *
 * Deliberately the only cross-tenant function in this module, and it is called
 * only by the daily cron — the loop still goes through the per-tenant
 * collect/analyse/save path, so no tenant ever sees another tenant's data.
 * Per-tenant failures are counted and do not stop the sweep.
 */
export async function refreshOpportunitiesForTrackedTenants(limit = 50): Promise<{
  tenants: number;
  opportunities: number;
  failed: number;
}> {
  const rows = await db
    .selectDistinctOn([competitors.tenantId], { tenantId: competitors.tenantId })
    .from(competitors)
    .limit(Math.max(1, Math.min(limit, 500)));

  const result = { tenants: 0, opportunities: 0, failed: 0 };
  for (const row of rows) {
    result.tenants += 1;
    try {
      const { opportunities } = await refreshOpportunities(row.tenantId);
      result.opportunities += opportunities.length;
    } catch (err) {
      result.failed += 1;
      console.error(`[MarketOpportunities] refresh failed for tenant ${row.tenantId}`, err);
    }
  }
  return result;
}

/**
 * Run the analysis for one tenant and persist the result. Used by the
 * dashboard's "Analyse now" button and by the daily cron.
 */
export async function refreshOpportunities(
  tenantId: string,
  options: { radiusKm?: number } = {}
): Promise<{ analysed: number; opportunities: Opportunity[] }> {
  const [competitors, tenantOffering] = await Promise.all([
    collectCompetitorOfferings(tenantId),
    collectTenantOffering(tenantId),
  ]);

  const opportunities = analyzeOpportunities({
    tenant: tenantOffering,
    competitors,
    radiusKm: options.radiusKm ?? 5,
  });

  await saveOpportunities(tenantId, opportunities);
  return { analysed: competitors.length, opportunities };
}
