import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { conversations, revenueEvents } from '@/lib/db/schema';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { averageCheckFromEnv, runRevenueClassificationCron, type RevenueClassificationStore } from '@/lib/revenue/cron';
import type { ClassificationResult, ConversationSnapshot, RevenueEventType } from '@/lib/revenue/classify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function toSnapshot(row: any): ConversationSnapshot {
  return {
    id: row.id,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
    lastMessageAt: row.lastMessageAt,
    avgCheckCents: averageCheckFromEnv(),
    messages: (row.messages ?? []).map((message: any) => ({
      direction: message.direction,
      content: message.content,
      createdAt: message.createdAt,
      isAIGenerated: message.isAIGenerated,
    })),
    reservation: row.reservations?.[0]
      ? { partySize: row.reservations[0].partySize, createdAt: row.reservations[0].createdAt }
      : null,
    waitlistEntry: row.waitlistEntries?.[0]
      ? { partySize: row.waitlistEntries[0].partySize, createdAt: row.waitlistEntries[0].createdAt }
      : null,
  };
}

const store: RevenueClassificationStore = {
  async findStaleUnclassified(cutoff: Date, limit: number): Promise<ConversationSnapshot[]> {
    const rows = await db.query.conversations.findMany({
      where: and(isNull(conversations.outcome), lte(conversations.lastMessageAt, cutoff)),
      limit,
      with: {
        messages: true,
        reservations: true,
        waitlistEntries: true,
      },
    });
    return rows.map(toSnapshot);
  },

  async updateConversationOutcome(conversationId: string, result: ClassificationResult, classifiedAt: Date): Promise<void> {
    await db
      .update(conversations)
      .set({
        outcome: result.outcome,
        estimatedValueCents: result.estimatedValueCents,
        outcomeClassifiedAt: classifiedAt,
        outcomeClassifier: result.classifier,
      })
      .where(eq(conversations.id, conversationId));
  },

  async hasRevenueEvent(conversationId: string, eventType: RevenueEventType): Promise<boolean> {
    const existing = await db.query.revenueEvents.findFirst({
      where: and(eq(revenueEvents.conversationId, conversationId), eq(revenueEvents.eventType, eventType)),
    });
    return !!existing;
  },

  async insertRevenueEvent(input): Promise<void> {
    await db.insert(revenueEvents).values({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      eventType: input.eventType,
      estimatedValueCents: input.estimatedValueCents,
      realizedCents: input.realizedCents,
      occurredAt: input.occurredAt,
    });
  },
};

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const summary = await runRevenueClassificationCron(store, {
    avgCheckCents: averageCheckFromEnv(),
  });

  return NextResponse.json({ ok: true, ...summary });
}
