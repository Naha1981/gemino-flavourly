import { and, asc, desc, eq, gte, like, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  competitorRatingHistory,
  competitors,
  contacts,
  conversations,
  messages,
} from '@/lib/db/schema';
import { isSignificantRatingDrop, trendOf, type CompetitorTrend, type RatingReading } from './competitor-ratings.ts';

/**
 * Gate #14 — Drizzle adapter for competitor rating monitoring.
 *
 * Every competitor read/write is tenant-scoped (the platform-wide cron uses
 * findAllCompetitors deliberately — it IS the whole point of that sweep).
 * neon-http has no interactive transactions, so recordReading performs its
 * UPDATE and history INSERT sequentially; a crash between them leaves the
 * current rating fresher than history, which the next run heals.
 */

export type CompetitorRow = typeof competitors.$inferSelect;
export type CompetitorHistoryRow = typeof competitorRatingHistory.$inferSelect;

export async function createCompetitor(tenantId: string, name: string, placeId: string): Promise<CompetitorRow> {
  const [row] = await db.insert(competitors).values({ tenantId, name, googlePlaceId: placeId }).returning();
  return row;
}

export async function listCompetitors(tenantId: string): Promise<CompetitorRow[]> {
  return db.select().from(competitors).where(eq(competitors.tenantId, tenantId)).orderBy(desc(competitors.createdAt));
}

/** Tenant-scoped lookup — a leaked competitor uuid is useless cross-tenant. */
export async function getCompetitor(tenantId: string, competitorId: string): Promise<CompetitorRow | null> {
  const [row] = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.tenantId, tenantId), eq(competitors.id, competitorId)))
    .limit(1);
  return row ?? null;
}

/** Tenant-scoped delete; false when the row belongs to another tenant. */
export async function deleteCompetitor(tenantId: string, competitorId: string): Promise<boolean> {
  const rows = await db
    .delete(competitors)
    .where(and(eq(competitors.tenantId, tenantId), eq(competitors.id, competitorId)))
    .returning({ id: competitors.id });
  return rows.length > 0;
}

/** The whole platform's competitor fleet — for the daily cron sweep only. */
export async function findAllCompetitors(): Promise<CompetitorRow[]> {
  return db.select().from(competitors).orderBy(asc(competitors.createdAt));
}

/**
 * Append a reading: refresh the competitor row (current rating/count +
 * last_check_at) and insert a history row. Sequential by design — see the
 * module comment about neon-http transactions.
 */
export async function updateRating(
  competitorId: string,
  rating: number,
  reviewCount: number,
  at: Date = new Date()
): Promise<void> {
  await db
    .update(competitors)
    .set({ currentRating: rating.toFixed(2), reviewCount, lastCheckAt: at })
    .where(eq(competitors.id, competitorId));
  await db.insert(competitorRatingHistory).values({ competitorId, rating: rating.toFixed(2), reviewCount, recordedAt: at });
}

/**
 * The most recent EXISTING reading (drop-detection input). The cron calls
 * this BEFORE recordReading(), so the newest stored row is by definition
 * "the previous reading". On an accidental same-day double run the newest
 * row equals the current rating, which simply yields "no drop" — the safe
 * direction (a false "no drop" wastes one alert chance; a false alert
 * erodes trust in every future alert).
 */
export async function getPreviousReading(competitorId: string): Promise<RatingReading | null> {
  const [newest] = await db
    .select()
    .from(competitorRatingHistory)
    .where(eq(competitorRatingHistory.competitorId, competitorId))
    .orderBy(desc(competitorRatingHistory.recordedAt))
    .limit(1);
  if (!newest) return null;
  return {
    rating: Number(newest.rating),
    reviewCount: newest.reviewCount,
    recordedAt: newest.recordedAt,
  };
}

/** Rating history for one competitor, newest first, last N days. */
export async function getRatingHistory(
  tenantId: string,
  competitorId: string,
  days = 90
): Promise<CompetitorHistoryRow[]> {
  // Scope through the competitor row so another tenant's history is never
  // readable, even with a leaked uuid.
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [owner] = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(and(eq(competitors.tenantId, tenantId), eq(competitors.id, competitorId)))
    .limit(1);
  if (!owner) return [];
  return db
    .select()
    .from(competitorRatingHistory)
    .where(and(eq(competitorRatingHistory.competitorId, competitorId), gte(competitorRatingHistory.recordedAt, since)))
    .orderBy(desc(competitorRatingHistory.recordedAt));
}

/** Pure drop check against stored history (also used by the dashboard). */
export async function detectRatingDrop(tenantId: string, competitorId: string): Promise<{
  dropped: boolean;
  previous: RatingReading | null;
}> {
  const readings = await getRatingHistory(tenantId, competitorId, 7);
  if (readings.length < 2) return { dropped: false, previous: null };
  const previousReading: RatingReading = {
    rating: Number(readings[1].rating),
    reviewCount: readings[1].reviewCount,
    recordedAt: readings[1].recordedAt,
  };
  const current = Number(readings[0].rating);
  return { dropped: isSignificantRatingDrop(previousReading.rating, current), previous: previousReading };
}

/** Trend badge input for the competitor list. */
export function competitorTrend(history: CompetitorHistoryRow[]): CompetitorTrend {
  return trendOf(
    history.map((row) => ({ rating: Number(row.rating), reviewCount: row.reviewCount, recordedAt: row.recordedAt }))
  );
}

// -----------------------------------------------------------------------------
// Alerts: system messages in the tenant's inbox
// -----------------------------------------------------------------------------

/**
 * The sentinel phone identifying the tenant's staff-facing notifications
 * conversation. It can never collide with a real WhatsApp number (JIDs are
 * digits+), and it is per-tenant so isolation holds.
 */
export const SYSTEM_ALERTS_PHONE = 'system-alerts';

/**
 * Find (or lazily create) the tenant's system-alerts conversation: a
 * synthetic contact + conversation that exists purely so staff-facing
 * alerts have a thread to live in. The inbox shows it like any thread; the
 * messages are direction 'system' and are never dispatched to anyone.
 */
export async function ensureSystemAlertsConversation(tenantId: string): Promise<string> {
  const [existingContact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.phone, SYSTEM_ALERTS_PHONE)))
    .limit(1);

  let contactId = existingContact?.id;
  if (!contactId) {
    const [created] = await db
      .insert(contacts)
      .values({ tenantId, phone: SYSTEM_ALERTS_PHONE, name: 'System Alerts', metadata: { system: true } })
      .returning({ id: contacts.id });
    contactId = created.id;
  }

  const [existingConversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contactId)))
    .limit(1);
  if (existingConversation) return existingConversation.id;

  const [created] = await db
    .insert(conversations)
    .values({ tenantId, contactId })
    .returning({ id: conversations.id });
  return created.id;
}

/** Insert a staff-facing alert (never dispatched — direction 'system'). */
export async function insertSystemAlert(tenantId: string, text: string): Promise<void> {
  const conversationId = await ensureSystemAlertsConversation(tenantId);
  await db.insert(messages).values({
    tenantId,
    conversationId,
    direction: 'system',
    content: text,
    isAIGenerated: false,
    messageType: 'system',
  });
}

/** Alert prefix used to identify competitor alerts in the message stream. */
export const COMPETITOR_ALERT_PREFIX = '⚠️ Competitor Alert:';

/** The tenant's competitor alerts from the last N days (dashboard banner). */
export async function recentCompetitorAlerts(tenantId: string, days = 7): Promise<string[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ content: messages.content })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.direction, 'system'),
        like(messages.content, `${COMPETITOR_ALERT_PREFIX}%`),
        gte(messages.createdAt, since)
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(50);
  return rows.map((row) => row.content);
}

// -----------------------------------------------------------------------------
// Super-admin platform metrics (Gate #14 admin extension)
// -----------------------------------------------------------------------------

/** Total competitors tracked across all tenants. */
export async function countAllCompetitors(): Promise<number> {
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(competitors);
  return Number(row?.value ?? 0);
}

/** Competitor rating-drop alerts raised in the last 7 days, platform-wide. */
export async function countRatingDropAlertsThisWeek(): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.direction, 'system'),
        like(messages.content, `${COMPETITOR_ALERT_PREFIX}%`),
        gte(messages.createdAt, since)
      )
    );
  return Number(row?.value ?? 0);
}

/** The cron-facing adapter satisfying ./competitor-ratings.ts's store. */
export const drizzleCompetitorRatingsStore = {
  // numeric columns come back as strings; the runner's contract is numeric.
  findAllCompetitors: async () =>
    (await findAllCompetitors()).map((row) => ({ ...row, currentRating: Number(row.currentRating) })),
  getPreviousReading,
  recordReading: updateRating,
  createAlert: insertSystemAlert,
};
