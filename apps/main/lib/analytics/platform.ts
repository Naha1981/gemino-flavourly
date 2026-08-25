import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  tenants,
  revenueEvents,
  messages,
  googleReviews,
  marketOpportunities,
  marketingCampaigns,
  customerProfiles,
} from '@/lib/db/schema';

const DAYS = 30;
const since = () => new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

async function groupedSum<T extends { tenantId: string; value: number }>(
  rows: Promise<{ tenantId: string; value: number | string }[]>
): Promise<Map<string, number>> {
  const data = await rows.catch(() => []);
  const map = new Map<string, number>();
  for (const r of data) map.set(r.tenantId, Number(r.value));
  return map;
}

export interface TenantComparisonRow {
  tenantId: string;
  name: string;
  revenueCents30: number;
  messages30: number;
  customers: number;
  reviews30: number;
  opportunities: number;
  campaigns: number;
}

export interface PlatformAnalytics {
  tenants: number;
  revenueCents30: number;
  messages30: number;
  reviews30: number;
  opportunities: number;
  campaigns: number;
  comparison: TenantComparisonRow[];
}

/**
 * Platform-wide analytics for the Super Admin. Every sub-query is either a
 * global aggregate or grouped by tenant_id, so no tenant ever sees another's
 * rows — this view only exists behind the Super Admin gate. Degrades to zeros
 * on any failure so the overview still renders.
 */
export async function fetchPlatformAnalytics(): Promise<PlatformAnalytics> {
  const cutoff = since();

  const tenantRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).catch(() => []);
  const ids = tenantRows.map((t) => t.id);

  const revenue = await groupedSum(
    db
      .select({ tenantId: revenueEvents.tenantId, value: sql<number>`COALESCE(SUM(${revenueEvents.realizedCents}),0)` })
      .from(revenueEvents)
      .where(gte(revenueEvents.occurredAt, cutoff))
      .groupBy(revenueEvents.tenantId) as any
  );
  const msgs = await groupedSum(
    db
      .select({ tenantId: messages.tenantId, value: sql<number>`COALESCE(COUNT(*),0)` })
      .from(messages)
      .where(gte(messages.createdAt, cutoff))
      .groupBy(messages.tenantId) as any
  );
  const reviews = await groupedSum(
    db
      .select({ tenantId: googleReviews.tenantId, value: sql<number>`COALESCE(COUNT(*),0)` })
      .from(googleReviews)
      .where(gte(googleReviews.time, cutoff))
      .groupBy(googleReviews.tenantId) as any
  );
  const opps = await groupedSum(
    db
      .select({ tenantId: marketOpportunities.tenantId, value: sql<number>`COALESCE(COUNT(*),0)` })
      .from(marketOpportunities)
      .groupBy(marketOpportunities.tenantId) as any
  );
  const camps = await groupedSum(
    db
      .select({ tenantId: marketingCampaigns.tenantId, value: sql<number>`COALESCE(COUNT(*),0)` })
      .from(marketingCampaigns)
      .groupBy(marketingCampaigns.tenantId) as any
  );
  const custs = await groupedSum(
    db
      .select({ tenantId: customerProfiles.tenantId, value: sql<number>`COALESCE(COUNT(*),0)` })
      .from(customerProfiles)
      .groupBy(customerProfiles.tenantId) as any
  );

  const comparison: TenantComparisonRow[] = tenantRows.map((t) => ({
    tenantId: t.id,
    name: t.name,
    revenueCents30: revenue.get(t.id) ?? 0,
    messages30: msgs.get(t.id) ?? 0,
    customers: custs.get(t.id) ?? 0,
    reviews30: reviews.get(t.id) ?? 0,
    opportunities: opps.get(t.id) ?? 0,
    campaigns: camps.get(t.id) ?? 0,
  }));

  return {
    tenants: ids.length,
    revenueCents30: Array.from(revenue.values()).reduce((a, b) => a + b, 0),
    messages30: Array.from(msgs.values()).reduce((a, b) => a + b, 0),
    reviews30: Array.from(reviews.values()).reduce((a, b) => a + b, 0),
    opportunities: Array.from(opps.values()).reduce((a, b) => a + b, 0),
    campaigns: Array.from(camps.values()).reduce((a, b) => a + b, 0),
    comparison,
  };
}
