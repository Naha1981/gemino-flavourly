import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { marketingCampaigns, tenants } from '@/lib/db/schema';

export type MarketingCampaignRow = typeof marketingCampaigns.$inferSelect;

export async function listMarketingCampaigns(tenantId: string): Promise<MarketingCampaignRow[]> {
  return db.select().from(marketingCampaigns).where(eq(marketingCampaigns.tenantId, tenantId)).orderBy(desc(marketingCampaigns.createdAt));
}

export async function getMarketingCampaign(tenantId: string, campaignId: string): Promise<MarketingCampaignRow | null> {
  const [row] = await db.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId))).limit(1);
  return row ?? null;
}

export async function createMarketingCampaign(input: {
  tenantId: string;
  name: string;
  description?: string | null;
  type: string;
  targetSegment?: string | null;
  offer?: string | null;
  message: string;
  startDate?: Date | null;
  endDate?: Date | null;
  estimatedReach?: number | null;
  estimatedRevenueCents?: number | null;
}): Promise<MarketingCampaignRow> {
  const [row] = await db.insert(marketingCampaigns).values({
    tenantId: input.tenantId,
    name: input.name,
    description: input.description ?? null,
    type: input.type as 'promotion' | 'event' | 'seasonal' | 'announcement' | 'custom',
    targetSegment: input.targetSegment ?? null,
    offer: input.offer ?? null,
    message: input.message,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    estimatedReach: input.estimatedReach ?? null,
    estimatedRevenueCents: input.estimatedRevenueCents ?? null,
    status: 'draft',
  }).returning();
  return row;
}

export async function updateMarketingCampaign(tenantId: string, campaignId: string, input: {
  name?: string;
  description?: string | null;
  type?: string;
  targetSegment?: string | null;
  offer?: string | null;
  message?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  estimatedReach?: number | null;
  estimatedRevenueCents?: number | null;
  status?: string;
}): Promise<MarketingCampaignRow | null> {
  const [row] = await db.update(marketingCampaigns).set({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.type !== undefined ? { type: input.type as 'promotion' | 'event' | 'seasonal' | 'announcement' | 'custom' } : {}),
    ...(input.targetSegment !== undefined ? { targetSegment: input.targetSegment } : {}),
    ...(input.offer !== undefined ? { offer: input.offer } : {}),
    ...(input.message !== undefined ? { message: input.message } : {}),
    ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
    ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
    ...(input.estimatedReach !== undefined ? { estimatedReach: input.estimatedReach } : {}),
    ...(input.estimatedRevenueCents !== undefined ? { estimatedRevenueCents: input.estimatedRevenueCents } : {}),
    ...(input.status !== undefined ? { status: input.status as 'draft' | 'scheduled' | 'sent' | 'failed' } : {}),
  }).where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId))).returning();
  return row ?? null;
}

export async function deleteMarketingCampaign(tenantId: string, campaignId: string): Promise<boolean> {
  const rows = await db.delete(marketingCampaigns).where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId))).returning({ id: marketingCampaigns.id });
  return rows.length > 0;
}

export async function countMarketingCampaigns(tenantId: string): Promise<number> {
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(marketingCampaigns).where(eq(marketingCampaigns.tenantId, tenantId));
  return Number(row?.value ?? 0);
}
