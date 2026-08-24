import {
  classifyConversation,
  classifyWithGroqGemini,
  type ClassificationResult,
  type ConversationSnapshot,
  type AiClassifier,
  type OutcomeClassifier,
  type RevenueEventType,
  type RevenueOutcome,
} from './classify.ts';

export interface RevenueClassificationStore {
  findStaleUnclassified(cutoff: Date, limit: number): Promise<ConversationSnapshot[]>;
  updateConversationOutcome(conversationId: string, result: ClassificationResult, classifiedAt: Date): Promise<void>;
  hasRevenueEvent(conversationId: string, eventType: RevenueEventType): Promise<boolean>;
  insertRevenueEvent(input: {
    tenantId: string;
    conversationId: string;
    eventType: RevenueEventType;
    estimatedValueCents: number;
    realizedCents: number;
    occurredAt: Date;
  }): Promise<void>;
}

export interface RevenueCronOptions {
  now?: Date;
  limit?: number;
  silentHours?: number;
  avgCheckCents?: number;
  aiClassifier?: AiClassifier;
}

export interface RevenueCronSummary {
  processed: number;
  classified: number;
  eventsCreated: number;
  outcomes: Record<RevenueOutcome, number>;
  samples: Array<{
    conversationId: string;
    outcome: RevenueOutcome;
    classifier: OutcomeClassifier;
    estimatedValueCents: number;
    reason: string;
  }>;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_SILENT_HOURS = 4;

export function averageCheckFromEnv(): number {
  const parsed = Number(process.env.REVENUE_AVG_CHECK_CENTS || process.env.DEFAULT_AVG_CHECK_CENTS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 35_000;
}

export async function runRevenueClassificationCron(
  store: RevenueClassificationStore,
  options: RevenueCronOptions = {}
): Promise<RevenueCronSummary> {
  const now = options.now ?? new Date();
  const silentHours = options.silentHours ?? DEFAULT_SILENT_HOURS;
  const cutoff = new Date(now.getTime() - silentHours * 60 * 60 * 1000);
  const candidates = await store.findStaleUnclassified(cutoff, options.limit ?? DEFAULT_LIMIT);
  const outcomes: RevenueCronSummary['outcomes'] = { converted: 0, missed: 0, handled: 0, lost: 0 };
  const samples: RevenueCronSummary['samples'] = [];
  let eventsCreated = 0;

  for (const candidate of candidates) {
    const result = await classifyConversation(candidate, {
      now,
      silentHours,
      avgCheckCents: options.avgCheckCents ?? candidate.avgCheckCents ?? averageCheckFromEnv(),
      aiClassifier: options.aiClassifier ?? classifyWithGroqGemini,
    });

    await store.updateConversationOutcome(candidate.id, result, now);
    outcomes[result.outcome] += 1;

    if (result.eventType) {
      const exists = await store.hasRevenueEvent(candidate.id, result.eventType);
      if (!exists) {
        await store.insertRevenueEvent({
          tenantId: candidate.tenantId,
          conversationId: candidate.id,
          eventType: result.eventType,
          estimatedValueCents: result.estimatedValueCents,
          realizedCents: result.outcome === 'converted' ? result.estimatedValueCents : 0,
          occurredAt: now,
        });
        eventsCreated += 1;
      }
    }

    if (samples.length < 5) {
      samples.push({
        conversationId: candidate.id,
        outcome: result.outcome,
        classifier: result.classifier,
        estimatedValueCents: result.estimatedValueCents,
        reason: result.reason,
      });
    }
  }

  return {
    processed: candidates.length,
    classified: candidates.length,
    eventsCreated,
    outcomes,
    samples,
  };
}
