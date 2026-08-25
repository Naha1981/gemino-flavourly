import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { competitorRatingHistory, competitors } from '@/lib/db/schema';

export function createCompetitor(tenantId: string, name: string, googlePlaceId: string) {
  return db.insert(competitors).values({ tenantId, name, googlePlaceId }).returning();
}

export function listCompetitors(tenantId: string) {
  return db.select().from(competitors).where(eq(competitors.tenantId, tenantId)).orderBy(desc(competitors.currentRating));
}

export async function updateRating(competitorId: string, rating: number, reviewCount: number) {
  const [updated] = await db.update(competitors).set({ currentRating: rating.toFixed(2), reviewCount, lastCheckAt: new Date() })
    .where(eq(competitors.id, competitorId)).returning();
  await db.insert(competitorRatingHistory).values({ competitorId, rating: rating.toFixed(2), reviewCount });
  return updated;
}

export function getRatingHistory(competitorId: string, days = 30) {
  return db.select().from(competitorRatingHistory).where(and(
    eq(competitorRatingHistory.competitorId, competitorId),
    gte(competitorRatingHistory.recordedAt, new Date(Date.now() - days * 86400000)),
  )).orderBy(desc(competitorRatingHistory.recordedAt));
}

export async function detectRatingDrop(competitorId: string) {
  const history = await db.select().from(competitorRatingHistory)
    .where(eq(competitorRatingHistory.competitorId, competitorId))
    .orderBy(desc(competitorRatingHistory.recordedAt)).limit(2);
  if (history.length < 2) return null;
  const oldRating = Number(history[1].rating);
  const newRating = Number(history[0].rating);
  return newRating < oldRating - 0.2 ? { oldRating, newRating } : null;
}
