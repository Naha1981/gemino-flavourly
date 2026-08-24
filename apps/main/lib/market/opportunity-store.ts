import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { marketOpportunities } from '@/lib/db/schema';
import type { Opportunity } from './opportunity-analyzer.ts';

/**
 * Gate #17 — Drizzle adapter for market opportunities.
 *
 * saveOpportunities upserts by (tenant_id, opportunity_key) so the
 * analyzer can re-run freely: confidence/description update in place while
 * the tenant's `addressed` flag survives. Opportunities that no longer
 * appear (the market closed the gap) are pruned UNLESS the tenant marked
 * them addressed — an addressed row is the tenant's own record.
 */

export type OpportunityRow = typeof marketOpportunities.$inferSelect;

export async function saveOpportunities(tenantId: string, opportunities: Opportunity[]): Promise<void> {
  if (opportunities.length === 0) {
    // An empty analysis is still meaningful: the market has no detectable
    // gaps — prune the unaddressed ones rather than leaving stale rows.
    await db
      .delete(marketOpportunities)
      .where(and(eq(marketOpportunities.tenantId, tenantId), eq(marketOpportunities.addressed, false)));
    return;
  }

  for (const opportunity of opportunities) {
    await db
      .insert(marketOpportunities)
      .values({
        tenantId,
        opportunityKey: opportunity.opportunityKey,
        category: opportunity.category,
        description: opportunity.description,
        confidence: opportunity.confidence.toFixed(2),
        evidence: opportunity.evidence,
      })
      .onConflictDoUpdate({
        target: [marketOpportunities.tenantId, marketOpportunities.opportunityKey],
        set: {
          category: opportunity.category,
          description: opportunity.description,
          confidence: opportunity.confidence.toFixed(2),
          evidence: opportunity.evidence,
          detectedAt: new Date(),
        },
      });
  }

  // Prune unaddressed rows the analyzer no longer reports.
  const keys = opportunities.map((o) => o.opportunityKey);
  await db
    .delete(marketOpportunities)
    .where(
      and(
        eq(marketOpportunities.tenantId, tenantId),
        eq(marketOpportunities.addressed, false),
        sql`${marketOpportunities.opportunityKey} NOT IN ${keys}`
      )
    );
}

/** All opportunities for a tenant, most confident first. */
export async function getOpportunities(tenantId: string): Promise<OpportunityRow[]> {
  return db
    .select()
    .from(marketOpportunities)
    .where(eq(marketOpportunities.tenantId, tenantId))
    .orderBy(desc(marketOpportunities.confidence), desc(marketOpportunities.detectedAt));
}

/**
 * Mark addressed — tenant-scoped, only flips false->true (a second click is
 * a no-op, and "unaddressing" is deliberately not offered: the flag is the
 * tenant's "we did this" record).
 */
export async function markAddressed(tenantId: string, opportunityId: string): Promise<boolean> {
  const rows = await db
    .update(marketOpportunities)
    .set({ addressed: true, addressedAt: new Date() })
    .where(
      and(
        eq(marketOpportunities.tenantId, tenantId),
        eq(marketOpportunities.id, opportunityId),
        eq(marketOpportunities.addressed, false)
      )
    )
    .returning({ id: marketOpportunities.id });
  return rows.length > 0;
}

/** Platform metric: total opportunities detected across all tenants. */
export async function countAllOpportunities(): Promise<number> {
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(marketOpportunities);
  return Number(row?.value ?? 0);
}
