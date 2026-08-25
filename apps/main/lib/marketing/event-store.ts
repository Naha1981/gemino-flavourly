import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { marketingEvents, tenants } from '@/lib/db/schema';

export type MarketingEventRow = typeof marketingEvents.$inferSelect;

export async function listMarketingEvents(tenantId: string): Promise<MarketingEventRow[]> {
  return db.select().from(marketingEvents).where(eq(marketingEvents.tenantId, tenantId)).orderBy(marketingEvents.startsAt);
}

export async function getMarketingEvent(tenantId: string, eventId: string): Promise<MarketingEventRow | null> {
  const [row] = await db.select().from(marketingEvents).where(and(eq(marketingEvents.id, eventId), eq(marketingEvents.tenantId, tenantId))).limit(1);
  return row ?? null;
}

export async function createMarketingEvent(input: {
  tenantId: string;
  name: string;
  description?: string | null;
  eventType: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  capacity?: number | null;
  message?: string | null;
}): Promise<MarketingEventRow> {
  const [row] = await db.insert(marketingEvents).values({
    tenantId: input.tenantId,
    name: input.name,
    description: input.description ?? null,
    eventType: input.eventType as 'special' | 'live_music' | 'tasting' | 'workshop' | 'holiday' | 'custom',
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    location: input.location ?? null,
    capacity: input.capacity ?? null,
    message: input.message ?? null,
    status: 'draft',
  }).returning();
  return row;
}

export async function updateMarketingEvent(tenantId: string, eventId: string, input: {
  name?: string;
  description?: string | null;
  eventType?: string;
  startsAt?: Date;
  endsAt?: Date;
  location?: string | null;
  capacity?: number | null;
  message?: string | null;
  status?: string;
}): Promise<MarketingEventRow | null> {
  const [row] = await db.update(marketingEvents).set({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.eventType !== undefined ? { eventType: input.eventType as 'special' | 'live_music' | 'tasting' | 'workshop' | 'holiday' | 'custom' } : {}),
    ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
    ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
    ...(input.message !== undefined ? { message: input.message } : {}),
    ...(input.status !== undefined ? { status: input.status as 'draft' | 'published' | 'cancelled' | 'completed' } : {}),
  }).where(and(eq(marketingEvents.id, eventId), eq(marketingEvents.tenantId, tenantId))).returning();
  return row ?? null;
}

export async function deleteMarketingEvent(tenantId: string, eventId: string): Promise<boolean> {
  const rows = await db.delete(marketingEvents).where(and(eq(marketingEvents.id, eventId), eq(marketingEvents.tenantId, tenantId))).returning({ id: marketingEvents.id });
  return rows.length > 0;
}

export async function countMarketingEvents(tenantId: string): Promise<number> {
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(marketingEvents).where(eq(marketingEvents.tenantId, tenantId));
  return Number(row?.value ?? 0);
}
