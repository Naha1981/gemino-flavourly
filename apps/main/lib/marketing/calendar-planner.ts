import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { marketOpportunities, tenants } from '@/lib/db/schema';
import { createMarketingEvent } from './event-store.ts';

export interface CalendarEvent {
  tenantId: string;
  name: string;
  description: string;
  eventType: 'special' | 'live_music' | 'tasting' | 'workshop' | 'holiday' | 'custom';
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  capacity?: number | null;
  message: string;
}

export interface CalendarPlanResult {
  eventsCreated: number;
  events: CalendarEvent[];
}

function startOfWeek(date: Date, day = 1): Date {
  const d = new Date(date);
  const diff = (d.getDay() + 7 - day) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
}

export function generateCalendar(tenantId: string, tenantName: string, now = new Date()): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const weeks: Date[] = [];

  let cursor = startOfWeek(monthStart);
  while (cursor <= monthEnd) {
    weeks.push(cursor);
    cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  for (let i = 0; i < weeks.length; i++) {
    const weekStart = weeks[i];
    const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);

    if (i % 2 === 0) {
      events.push({
        tenantId,
        name: 'Weekend Special',
        description: 'Weekend dining experience',
        eventType: 'special',
        startsAt: weekStart,
        endsAt: weekEnd,
        message: `Join us for a special weekend dining experience at ${tenantName}.`,
      });
    }

    if (i % 3 === 0) {
      const wsStart = new Date(weekStart);
      wsStart.setHours(17, 0, 0, 0);
      const wsEnd = new Date(weekStart);
      wsEnd.setHours(20, 0, 0, 0);
      events.push({
        tenantId,
        name: 'Wine Tasting',
        description: 'Weekly wine tasting session',
        eventType: 'tasting',
        startsAt: wsStart,
        endsAt: wsEnd,
        location: 'Main dining area',
        capacity: 20,
        message: `Experience our curated wine selection at ${tenantName}.`,
      });
    }
  }

  return events;
}

export async function runCalendarPlanner(
  tenantId: string,
  tenantName: string,
  now = new Date()
): Promise<CalendarPlanResult> {
  const planned = generateCalendar(tenantId, tenantName, now);
  let created = 0;

  const existingKeys = new Set(
    (
      await db
        .select({ key: marketOpportunities.key })
        .from(marketOpportunities)
        .where(eq(marketOpportunities.tenantId, tenantId))
    ).map((r) => r.key)
  );

  const eventOpportunities = await db
    .select()
    .from(marketOpportunities)
    .where(and(eq(marketOpportunities.tenantId, tenantId), eq(marketOpportunities.opportunityType, 'event')));

  for (const opp of eventOpportunities) {
    if (existingKeys.has(opp.key)) continue;
    const oppDate = new Date(opp.title);
    if (!Number.isNaN(oppDate.getTime())) {
      planned.push({
        tenantId,
        name: opp.title,
        description: opp.description,
        eventType: 'holiday',
        startsAt: oppDate,
        endsAt: oppDate,
        message: `Celebrate ${opp.title} with us at ${tenantName}.`,
      });
    }
  }

  for (const evt of planned) {
    const exists = await db
      .select({ id: marketOpportunities.id })
      .from(marketOpportunities)
      .where(and(eq(marketOpportunities.tenantId, tenantId), eq(marketOpportunities.key, `event:${evt.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}:${now.getFullYear()}`)))
      .limit(1);

    if (exists.length > 0) continue;

    try {
      await createMarketingEvent({
        tenantId: evt.tenantId,
        name: evt.name,
        description: evt.description,
        eventType: evt.eventType,
        startsAt: evt.startsAt,
        endsAt: evt.endsAt,
        location: evt.location ?? null,
        capacity: evt.capacity ?? null,
        message: evt.message,
      });
      created += 1;
    } catch (err) {
      console.error(`[CalendarPlanner] Failed to create event "${evt.name}" for tenant ${tenantId}`, err);
    }
  }

  return { eventsCreated: created, events: planned };
}
