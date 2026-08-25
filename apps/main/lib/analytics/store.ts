import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  revenueEvents,
  messages,
  googleReviews,
  marketOpportunities,
  marketingCampaigns,
  customerProfiles,
} from '@/lib/db/schema';
import { type DailyPoint, type CohortInput } from './engine';

/**
 * Tenant-scoped analytics data access.
 *
 * Every query filters by `tenant_id` (no cross-tenant leakage) and degrades
 * to an empty series on failure so the dashboard renders rather than 500s.
 * The engine module turns these raw series into KPIs — this file only ever
 * reads and buckets.
 */

const DEFAULT_DAYS = 120;

function dayBucket(table: any, column: any) {
  return sql<string>`to_char(${column}, 'YYYY-MM-DD')`;
}

export async function fetchRevenueSeries(tenantId: string, days = DEFAULT_DAYS): Promise<DailyPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select({
      date: dayBucket(revenueEvents, revenueEvents.occurredAt),
      value: sql<number>`COALESCE(SUM(${revenueEvents.realizedCents}), 0)`,
    })
    .from(revenueEvents)
    .where(and(eq(revenueEvents.tenantId, tenantId), gte(revenueEvents.occurredAt, since)))
    .groupBy(sql`to_char(${revenueEvents.occurredAt}, 'YYYY-MM-DD')`)
    .then((rows) => rows.map((r) => ({ date: r.date, value: Number(r.value) })))
    .catch(() => []);
}

export async function fetchOperationsSeries(tenantId: string, days = DEFAULT_DAYS): Promise<DailyPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select({
      date: dayBucket(messages, messages.createdAt),
      value: sql<number>`COALESCE(COUNT(*), 0)`,
    })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), gte(messages.createdAt, since)))
    .groupBy(sql`to_char(${messages.createdAt}, 'YYYY-MM-DD')`)
    .then((rows) => rows.map((r) => ({ date: r.date, value: Number(r.value) })))
    .catch(() => []);
}

export async function fetchReputationSeries(tenantId: string, days = DEFAULT_DAYS): Promise<DailyPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select({
      date: dayBucket(googleReviews, googleReviews.time),
      value: sql<number>`COALESCE(COUNT(*), 0)`,
    })
    .from(googleReviews)
    .where(and(eq(googleReviews.tenantId, tenantId), gte(googleReviews.time, since)))
    .groupBy(sql`to_char(${googleReviews.time}, 'YYYY-MM-DD')`)
    .then((rows) => rows.map((r) => ({ date: r.date, value: Number(r.value) })))
    .catch(() => []);
}

export async function fetchMarketSeries(tenantId: string, days = DEFAULT_DAYS): Promise<DailyPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select({
      date: dayBucket(marketOpportunities, marketOpportunities.detectedAt),
      value: sql<number>`COALESCE(COUNT(*), 0)`,
    })
    .from(marketOpportunities)
    .where(and(eq(marketOpportunities.tenantId, tenantId), gte(marketOpportunities.detectedAt, since)))
    .groupBy(sql`to_char(${marketOpportunities.detectedAt}, 'YYYY-MM-DD')`)
    .then((rows) => rows.map((r) => ({ date: r.date, value: Number(r.value) })))
    .catch(() => []);
}

export async function fetchMarketingSeries(tenantId: string, days = DEFAULT_DAYS): Promise<DailyPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select({
      date: dayBucket(marketingCampaigns, marketingCampaigns.launchedAt),
      value: sql<number>`COALESCE(COUNT(*), 0)`,
    })
    .from(marketingCampaigns)
    .where(
      and(
        eq(marketingCampaigns.tenantId, tenantId),
        gte(marketingCampaigns.launchedAt, since),
        sql`${marketingCampaigns.launchedAt} IS NOT NULL`
      )
    )
    .groupBy(sql`to_char(${marketingCampaigns.launchedAt}, 'YYYY-MM-DD')`)
    .then((rows) => rows.map((r) => ({ date: r.date, value: Number(r.value) })))
    .catch(() => []);
}

/** Customer cohort inputs derived from first/last visit months. */
export async function fetchCustomerCohorts(tenantId: string): Promise<CohortInput[]> {
  const rows = await db
    .select({
      firstVisitAt: customerProfiles.firstVisitAt,
      lastVisitAt: customerProfiles.lastVisitAt,
    })
    .from(customerProfiles)
    .where(eq(customerProfiles.tenantId, tenantId))
    .catch(() => []);

  const out: CohortInput[] = [];
  for (const r of rows) {
    if (!r.firstVisitAt || !r.lastVisitAt) continue;
    const first = new Date(r.firstVisitAt);
    const last = new Date(r.lastVisitAt);
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) continue;
    const firstKey = first.toISOString().slice(0, 7);
    const lastKey = last.toISOString().slice(0, 7);
    let cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    const end = new Date(last.getFullYear(), last.getMonth(), 1);
    while (cursor <= end) {
      out.push({
        firstMonth: firstKey,
        customerId: `${tenantId}:${r.firstVisitAt}`,
        activeMonth: cursor.toISOString().slice(0, 7),
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }
  return out;
}

export interface EngineSeriesBundle {
  revenue: DailyPoint[];
  operations: DailyPoint[];
  reputation: DailyPoint[];
  market: DailyPoint[];
  marketing: DailyPoint[];
  cohorts: CohortInput[];
}

export async function fetchAllEngineSeries(tenantId: string): Promise<EngineSeriesBundle> {
  const [revenue, operations, reputation, market, marketing, cohorts] = await Promise.all([
    fetchRevenueSeries(tenantId),
    fetchOperationsSeries(tenantId),
    fetchReputationSeries(tenantId),
    fetchMarketSeries(tenantId),
    fetchMarketingSeries(tenantId),
    fetchCustomerCohorts(tenantId),
  ]);
  return { revenue, operations, reputation, market, marketing, cohorts };
}
