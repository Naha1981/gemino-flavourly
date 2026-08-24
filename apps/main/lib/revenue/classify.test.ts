import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyConversation, inferPartySize, parseAiClassification, type ConversationSnapshot } from './classify.ts';

const now = new Date('2026-08-24T12:00:00.000Z');
const stale = new Date(now.getTime() - 5 * 60 * 60 * 1000);
const recent = new Date(now.getTime() - 30 * 60 * 1000);

function sample(partial: Partial<ConversationSnapshot>): ConversationSnapshot {
  return {
    id: 'conv-1',
    tenantId: 'tenant-1',
    createdAt: stale,
    lastMessageAt: stale,
    avgCheckCents: 10_000,
    messages: [],
    ...partial,
  };
}

describe('revenue classifyConversation rule outcomes', () => {
  test('1. reservation linked to a conversation converts at avg check times party size', async () => {
    const result = await classifyConversation(sample({ reservation: { partySize: 4 } }), { now });
    assert.equal(result.outcome, 'converted');
    assert.equal(result.estimatedValueCents, 40_000);
    assert.equal(result.eventType, 'booking');
  });

  test('2. waitlist linked to a conversation converts at lower confidence', async () => {
    const result = await classifyConversation(sample({ waitlistEntry: { partySize: 4 } }), { now });
    assert.equal(result.outcome, 'converted');
    assert.equal(result.estimatedValueCents, 20_000);
    assert.equal(result.eventType, 'waitlist');
  });

  test('3. stale unanswered booking enquiry is missed', async () => {
    const result = await classifyConversation(
      sample({ messages: [{ direction: 'inbound', content: 'Can I book a table for 5 tonight?', createdAt: stale }] }),
      { now }
    );
    assert.equal(result.outcome, 'missed');
    assert.equal(result.estimatedValueCents, 50_000);
  });

  test('4. stale unanswered menu enquiry is missed revenue', async () => {
    const result = await classifyConversation(
      sample({ messages: [{ direction: 'inbound', content: 'Please send the dinner menu for two', createdAt: stale }] }),
      { now }
    );
    assert.equal(result.outcome, 'missed');
    assert.equal(result.estimatedValueCents, 20_000);
  });

  test('5. hours-only question is handled', async () => {
    const result = await classifyConversation(
      sample({ messages: [{ direction: 'inbound', content: 'What hours are you open?', createdAt: stale }] }),
      { now }
    );
    assert.equal(result.outcome, 'handled');
    assert.equal(result.estimatedValueCents, 0);
  });

  test('6. location-only question is handled', async () => {
    const result = await classifyConversation(
      sample({ messages: [{ direction: 'inbound', content: 'Where is your address and parking?', createdAt: stale }] }),
      { now }
    );
    assert.equal(result.outcome, 'handled');
  });

  test('7. recent booking enquiry is not prematurely classified as missed', async () => {
    const result = await classifyConversation(
      sample({
        lastMessageAt: recent,
        messages: [{ direction: 'inbound', content: 'Book a table for 3 please', createdAt: recent }],
      }),
      { now }
    );
    assert.equal(result.outcome, 'handled');
  });

  test('8. customer follow-up interest with no later outbound reply is lost', async () => {
    const result = await classifyConversation(
      sample({ messages: [{ direction: 'inbound', content: 'I am interested, please call me back about options', createdAt: stale }] }),
      { now }
    );
    assert.equal(result.outcome, 'lost');
    assert.equal(result.estimatedValueCents, 20_000);
  });

  test('9. ambiguous conversation uses AI classifier and caches a valid JSON outcome', async () => {
    let calls = 0;
    const aiClassifier = async () => {
      calls++;
      return parseAiClassification('{"outcome":"LOST","estimatedValueCents":30000,"reason":"guest wanted a manager callback"}');
    };
    const conversation = sample({ messages: [{ direction: 'inbound', content: 'Could someone senior help me with this request?', createdAt: stale }] });
    const first = await classifyConversation(conversation, { now, aiClassifier });
    const second = await classifyConversation(conversation, { now, aiClassifier });
    assert.equal(first.outcome, 'lost');
    assert.equal(second.outcome, 'lost');
    assert.equal(calls, 1);
  });

  test('10. outbound response after factual Q&A remains handled', async () => {
    const result = await classifyConversation(
      sample({
        messages: [
          { direction: 'inbound', content: 'What time do you close?', createdAt: new Date(stale.getTime() - 1_000) },
          { direction: 'outbound', content: 'We close at 10pm.', createdAt: stale },
        ],
      }),
      { now }
    );
    assert.equal(result.outcome, 'handled');
  });
});

describe('revenue classifier helpers', () => {
  test('infers numeric and word party sizes', () => {
    assert.equal(inferPartySize('table for 7'), 7);
    assert.equal(inferPartySize('we are four people'), 4);
  });
});
