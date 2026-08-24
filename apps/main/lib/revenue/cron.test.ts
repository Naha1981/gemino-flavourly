import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runRevenueClassificationCron, type RevenueClassificationStore } from './cron.ts';
import type { ClassificationResult, ConversationSnapshot, RevenueEventType } from './classify.ts';

const now = new Date('2026-08-24T12:00:00.000Z');
const stale = new Date(now.getTime() - 5 * 60 * 60 * 1000);

function missedConversation(id = 'conv-missed'): ConversationSnapshot {
  return {
    id,
    tenantId: 'tenant-1',
    createdAt: stale,
    lastMessageAt: stale,
    avgCheckCents: 12_000,
    messages: [{ direction: 'inbound', content: 'Can I book a table for 3?', createdAt: stale }],
  };
}

describe('revenue classification cron integration', () => {
  test('classifies stale conversations and records missed revenue events once', async () => {
    const updates: Array<{ conversationId: string; result: ClassificationResult; classifiedAt: Date }> = [];
    const events: Array<{ conversationId: string; eventType: RevenueEventType; estimatedValueCents: number }> = [];
    let cutoffSeen: Date | null = null;

    const store: RevenueClassificationStore = {
      async findStaleUnclassified(cutoff, limit) {
        cutoffSeen = cutoff;
        assert.equal(limit, 50);
        return [missedConversation()];
      },
      async updateConversationOutcome(conversationId, result, classifiedAt) {
        updates.push({ conversationId, result, classifiedAt });
      },
      async hasRevenueEvent() {
        return false;
      },
      async insertRevenueEvent(input) {
        events.push({
          conversationId: input.conversationId,
          eventType: input.eventType,
          estimatedValueCents: input.estimatedValueCents,
        });
      },
    };

    const summary = await runRevenueClassificationCron(store, { now, avgCheckCents: 12_000 });

    assert.ok(cutoffSeen);
    assert.equal((cutoffSeen as Date).toISOString(), new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString());
    assert.equal(summary.processed, 1);
    assert.equal(summary.outcomes.missed, 1);
    assert.equal(updates[0].result.outcome, 'missed');
    assert.equal(updates[0].result.estimatedValueCents, 36_000);
    assert.deepEqual(events, [
      { conversationId: 'conv-missed', eventType: 'missed_enquiry', estimatedValueCents: 36_000 },
    ]);
  });

  test('does not duplicate revenue events already created by a previous run', async () => {
    let insertCalled = false;
    const store: RevenueClassificationStore = {
      async findStaleUnclassified() {
        return [missedConversation('conv-already-evented')];
      },
      async updateConversationOutcome() {},
      async hasRevenueEvent() {
        return true;
      },
      async insertRevenueEvent() {
        insertCalled = true;
      },
    };

    const summary = await runRevenueClassificationCron(store, { now, avgCheckCents: 12_000 });
    assert.equal(summary.eventsCreated, 0);
    assert.equal(insertCalled, false);
  });
});

describe('revenue missed enquiry E2E simulation', () => {
  test('send a booking enquiry, ignore it for 4h, then verify it appears as missed', async () => {
    const inboundAt = new Date('2026-08-24T08:00:00.000Z');
    const afterFourHours = new Date('2026-08-24T12:01:00.000Z');
    const conversation = {
      id: 'conv-e2e-booking-ignore',
      tenantId: 'tenant-e2e',
      createdAt: inboundAt,
      lastMessageAt: inboundAt,
      avgCheckCents: 15_000,
      messages: [{ direction: 'inbound' as const, content: 'Hi, can I book a table for 4 tonight?', createdAt: inboundAt }],
    } satisfies ConversationSnapshot;

    let dashboardRow: ClassificationResult | null = null;
    const store: RevenueClassificationStore = {
      async findStaleUnclassified() {
        return [conversation];
      },
      async updateConversationOutcome(_conversationId, result) {
        dashboardRow = result;
      },
      async hasRevenueEvent() {
        return false;
      },
      async insertRevenueEvent() {},
    };

    await runRevenueClassificationCron(store, { now: afterFourHours, avgCheckCents: 15_000 });

    assert.ok(dashboardRow);
    assert.equal((dashboardRow as ClassificationResult).outcome, 'missed');
    assert.equal((dashboardRow as ClassificationResult).estimatedValueCents, 60_000);
  });
});
