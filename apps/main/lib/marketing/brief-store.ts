import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { marketingBriefs } from '@/lib/db/schema';
import type { DailyBrief } from './brief-generator';

export type MarketingBriefRow = typeof marketingBriefs.$inferSelect;

export async function saveBrief(tenantId: string, brief: DailyBrief): Promise<MarketingBriefRow> {
  const [row] = await db.insert(marketingBriefs).values({ tenantId, brief }).returning();
  return row;
}

export async function getLatestBrief(tenantId: string): Promise<MarketingBriefRow | null> {
  const [row] = await db.select().from(marketingBriefs)
    .where(eq(marketingBriefs.tenantId, tenantId))
    .orderBy(desc(marketingBriefs.generatedAt)).limit(1);
  return row ?? null;
}

export async function getBriefHistory(tenantId: string, limit = 20): Promise<MarketingBriefRow[]> {
  return db.select().from(marketingBriefs)
    .where(and(eq(marketingBriefs.tenantId, tenantId)))
    .orderBy(desc(marketingBriefs.generatedAt)).limit(Math.max(1, Math.min(limit, 100)));
}