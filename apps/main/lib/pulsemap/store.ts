/**
 * GATE PM-1 — the Drizzle store for PulseMap simulations.
 *
 * TENANT ISOLATION: every read/write keys on `tenant_id` in the WHERE
 * clause — a cross-tenant simulation id simply does not resolve. Demo
 * scoping follows the UI-3R rule: live views exclude deadbeef rows unless
 * Demo Mode is ON (includeDemoRows), and simulations for demo data are
 * themselves deadbeef-seeded.
 *
 * This module is imported by route handlers only (initializes the live db
 * client); framework-free logic lives in the sibling pure modules.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { liveRowsOnly, type QueryScopeOptions } from '@/lib/demo/query-scope';
import {
  campaignSimulations,
  campaignSimulationSegments,
  competitors,
  competitorPromotions,
  customerProfiles,
  googleReviews,
  marketingCampaigns,
  tenants,
} from '@/lib/db/schema';
import { extractSpecifics } from '@/lib/reputation/response-generator';
import type {
  Forecast,
  MarketSignal,
  PastCampaignStat,
  ReviewSignal,
  SegmentReaction,
  SimulationOutcome,
} from './types.ts';
import type { ProfileRowForAggregation } from './aggregate.ts';

// ---------------------------------------------------------------------------
// Context inputs (reads only — aggregation happens in pure code)
// ---------------------------------------------------------------------------

/** Aggregate-relevant columns ONLY — the query itself cannot leak PII. */
export async function fetchProfileRowsForPulseMap(
  tenantId: string,
  scope: QueryScopeOptions = {},
): Promise<ProfileRowForAggregation[]> {
  return db
    .select({
      segment: customerProfiles.segment,
      totalVisits: customerProfiles.totalVisits,
      totalSpendCents: customerProfiles.totalSpendCents,
      lastVisitAt: customerProfiles.lastVisitAt,
    })
    .from(customerProfiles)
    .where(
      and(
        eq(customerProfiles.tenantId, tenantId),
        liveRowsOnly(customerProfiles.id, scope),
      ),
    )
    .limit(5000);
}

export async function fetchPastCampaignsForPulseMap(
  tenantId: string,
  scope: QueryScopeOptions = {},
): Promise<PastCampaignStat[]> {
  return db
    .select({
      name: marketingCampaigns.name,
      status: marketingCampaigns.status,
      targetSegment: marketingCampaigns.targetSegment,
      sentCount: marketingCampaigns.sentCount,
      estimatedReach: marketingCampaigns.estimatedReach,
      estimatedRevenueCents: marketingCampaigns.estimatedRevenueCents,
    })
    .from(marketingCampaigns)
    .where(
      and(
        eq(marketingCampaigns.tenantId, tenantId),
        liveRowsOnly(marketingCampaigns.id, scope),
      ),
    )
    .orderBy(desc(marketingCampaigns.createdAt))
    .limit(10);
}

/**
 * Public review signal: rating average + LOCALLY extracted theme words.
 * Review text is read server-side but only lexicon WORDS leave this
 * function — never names, never full text.
 */
export async function fetchReviewSignalForPulseMap(
  tenantId: string,
  scope: QueryScopeOptions = {},
): Promise<ReviewSignal> {
  const rows = await db
    .select({ rating: googleReviews.rating, text: googleReviews.text })
    .from(googleReviews)
    .where(and(eq(googleReviews.tenantId, tenantId), liveRowsOnly(googleReviews.id, scope)))
    .limit(200);

  if (rows.length === 0) {
    return { totalReviews: 0, avgRating: null, themes: [] };
  }
  const sum = rows.reduce((acc, r) => acc + (Number.isFinite(r.rating) ? r.rating : 0), 0);
  const wordFreq = new Map<string, number>();
  for (const row of rows) {
    for (const word of [
      ...extractSpecifics(row.text).dishes,
      ...extractSpecifics(row.text).ambiance,
      ...extractSpecifics(row.text).staff,
    ]) {
      wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
    }
  }
  const themes = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 8);
  return {
    totalReviews: rows.length,
    avgRating: Math.round((sum / rows.length) * 10) / 10,
    themes,
  };
}

export async function fetchMarketSignalForPulseMap(
  tenantId: string,
  scope: QueryScopeOptions = {},
): Promise<MarketSignal> {
  const competitorRows = await db
    .select({ currentRating: competitors.currentRating })
    .from(competitors)
    .where(and(eq(competitors.tenantId, tenantId), liveRowsOnly(competitors.id, scope)))
    .limit(50);

  const [promoRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(competitorPromotions)
    .innerJoin(competitors, eq(competitorPromotions.competitorId, competitors.id))
    .where(and(eq(competitors.tenantId, tenantId), liveRowsOnly(competitors.id, scope)));

  const ratings = competitorRows
    .map((c) => Number(c.currentRating))
    .filter((n) => Number.isFinite(n) && n > 0);
  return {
    competitorCount: competitorRows.length,
    avgCompetitorRating: ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    activePromotions: Number(promoRow?.value ?? 0),
  };
}

export async function fetchRestaurantContext(tenantId: string) {
  const [row] = await db
    .select({
      name: tenants.name,
      description: tenants.description,
      openingHours: tenants.openingHours,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row ?? { name: 'Your restaurant', description: null, openingHours: null };
}

// ---------------------------------------------------------------------------
// Simulation persistence (tenant-scoped writes)
// ---------------------------------------------------------------------------

export interface SimulationWithSegments {
  id: string;
  tenantId: string;
  campaignId: string | null;
  inputHash: string;
  source: 'ai' | 'demo';
  status: 'complete' | 'unavailable';
  score: number | null;
  readiness: 'ready' | 'improve' | 'rework' | null;
  bestSegment: string | null;
  purchaseIntent: string | null;
  objections: string[] | null;
  likelyReplies: string[] | null;
  riskFlags: string[] | null;
  improvedCopy: string | null;
  explanation: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  assumptions: string[] | null;
  segmentSummaries: unknown;
  model: string | null;
  appliedAt: Date | null;
  appliedToCampaignId: string | null;
  createdAt: Date;
  segments: SegmentReaction[];
}

function mapSimulationRow(row: typeof campaignSimulations.$inferSelect, segments: SegmentReaction[]): SimulationWithSegments {
  return {
    id: row.id,
    tenantId: row.tenantId,
    campaignId: row.campaignId,
    inputHash: row.inputHash,
    source: (row.source as 'ai' | 'demo') ?? 'ai',
    status: (row.status as 'complete' | 'unavailable') ?? 'complete',
    score: row.score,
    readiness: (row.readiness as 'ready' | 'improve' | 'rework') ?? null,
    bestSegment: row.bestSegment,
    purchaseIntent: row.purchaseIntent,
    objections: (row.objections as string[] | null) ?? null,
    likelyReplies: (row.likelyReplies as string[] | null) ?? null,
    riskFlags: (row.riskFlags as string[] | null) ?? null,
    improvedCopy: row.improvedCopy,
    explanation: row.explanation,
    confidence: (row.confidence as 'low' | 'medium' | 'high') ?? null,
    assumptions: (row.assumptions as string[] | null) ?? null,
    segmentSummaries: row.segmentSummaries,
    model: row.model,
    appliedAt: row.appliedAt,
    appliedToCampaignId: row.appliedToCampaignId,
    createdAt: row.createdAt,
    segments,
  };
}

async function loadSegmentsFor(simulationId: string): Promise<SegmentReaction[]> {
  const rows = await db
    .select({
      segment: campaignSimulationSegments.segment,
      reaction: campaignSimulationSegments.reaction,
      purchaseIntent: campaignSimulationSegments.purchaseIntent,
      primaryObjection: campaignSimulationSegments.primaryObjection,
    })
    .from(campaignSimulationSegments)
    .where(eq(campaignSimulationSegments.simulationId, simulationId));
  return rows.map((r) => ({
    segment: r.segment as SegmentReaction['segment'],
    reaction: r.reaction ?? '',
    purchaseIntent: r.purchaseIntent ?? 0,
    primaryObjection: r.primaryObjection,
  }));
}

/** Insert a simulation (and its segment rows). Tenant-scoped by construction. */
export async function insertSimulation(input: {
  tenantId: string;
  campaignId: string | null;
  inputHash: string;
  source: 'ai' | 'demo';
  outcome: SimulationOutcome;
  segmentSummaries: unknown;
}): Promise<SimulationWithSegments> {
  const forecast: Forecast | null = input.outcome.forecast;
  const [row] = await db
    .insert(campaignSimulations)
    .values({
      tenantId: input.tenantId,
      campaignId: input.campaignId,
      inputHash: input.inputHash,
      source: input.outcome.source,
      status: input.outcome.status,
      score: forecast?.score ?? null,
      readiness: forecast?.readiness ?? null,
      bestSegment: forecast?.bestSegment ?? null,
      purchaseIntent: forecast?.purchaseIntent ?? null,
      objections: forecast?.objections ?? null,
      likelyReplies: forecast?.likelyReplies ?? null,
      riskFlags: forecast?.riskFlags ?? null,
      improvedCopy: forecast?.improvedCopy ?? null,
      explanation: forecast?.explanation ?? null,
      confidence: forecast?.confidence ?? null,
      assumptions: forecast?.assumptions ?? null,
      segmentSummaries: input.segmentSummaries as never,
      model: input.outcome.model,
    })
    .returning();

  let segments: SegmentReaction[] = [];
  if (forecast) {
    await db.insert(campaignSimulationSegments).values(
      forecast.segmentReactions.map((r) => ({
        simulationId: row.id,
        segment: r.segment,
        reaction: r.reaction,
        purchaseIntent: r.purchaseIntent,
        primaryObjection: r.primaryObjection,
      })),
    );
    segments = forecast.segmentReactions;
  }
  return mapSimulationRow(row, segments);
}

/** Latest simulation for one campaign (tenant-scoped). */
export async function latestSimulationForCampaign(
  tenantId: string,
  campaignId: string,
): Promise<SimulationWithSegments | null> {
  const [row] = await db
    .select()
    .from(campaignSimulations)
    .where(and(eq(campaignSimulations.tenantId, tenantId), eq(campaignSimulations.campaignId, campaignId)))
    .orderBy(desc(campaignSimulations.createdAt))
    .limit(1);
  if (!row) return null;
  return mapSimulationRow(row, await loadSegmentsFor(row.id));
}

/** One simulation by id — a foreign tenant's id does not resolve (isolation). */
export async function getSimulationForTenant(
  tenantId: string,
  simulationId: string,
): Promise<SimulationWithSegments | null> {
  const [row] = await db
    .select()
    .from(campaignSimulations)
    .where(and(eq(campaignSimulations.tenantId, tenantId), eq(campaignSimulations.id, simulationId)))
    .limit(1);
  if (!row) return null;
  return mapSimulationRow(row, await loadSegmentsFor(row.id));
}

/** Latest simulation per campaign for a whole tenant (page chips). */
export async function latestSimulationsByCampaign(
  tenantId: string,
  scope: QueryScopeOptions = {},
): Promise<Map<string, SimulationWithSegments>> {
  const rows = await db
    .select()
    .from(campaignSimulations)
    .where(and(eq(campaignSimulations.tenantId, tenantId), liveRowsOnly(campaignSimulations.id, scope)))
    .orderBy(desc(campaignSimulations.createdAt));
  const byCampaign = new Map<string, SimulationWithSegments>();
  for (const row of rows) {
    if (row.campaignId && !byCampaign.has(row.campaignId)) {
      byCampaign.set(row.campaignId, mapSimulationRow(row, []));
    }
  }
  return byCampaign;
}

/** Stamp that the owner applied this simulation's improved copy. */
export async function markSimulationApplied(
  tenantId: string,
  simulationId: string,
  campaignId: string,
): Promise<boolean> {
  const rows = await db
    .update(campaignSimulations)
    .set({ appliedAt: new Date(), appliedToCampaignId: campaignId })
    .where(and(eq(campaignSimulations.tenantId, tenantId), eq(campaignSimulations.id, simulationId)))
    .returning({ id: campaignSimulations.id });
  return rows.length > 0;
}
