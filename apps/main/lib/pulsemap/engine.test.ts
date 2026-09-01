import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { hashSimulationInput, runSimulation } from './engine.ts';
import { generateDemoForecast } from './demo-forecast.ts';
import { SIMULATION_UNAVAILABLE_MESSAGE, FORECAST_DISCLAIMER } from './types.ts';
import type { SimulationContext } from './types.ts';

const CTX: SimulationContext = {
  draft: { title: 'T', message: 'R299 for two this Thursday', offer: null, targetSegment: 'regular', sendAt: null },
  restaurant: { name: 'The Grand Bistro', description: null, openingHours: null },
  segmentSummaries: [
    { segment: 'vip', count: 2, avgVisits: 12, avgSpendCents: 250000, avgDaysSinceLastVisit: 20 },
    { segment: 'regular', count: 5, avgVisits: 7, avgSpendCents: 100000, avgDaysSinceLastVisit: 35 },
  ],
  pastCampaigns: [],
  reviewSignal: null,
  marketSignal: null,
};

const DRAFT = { title: 'T', message: 'm', offer: null, targetSegment: 'regular', sendAt: null };

test('hashSimulationInput is stable across key order and repeat calls', () => {
  const a = hashSimulationInput({ draft: DRAFT, segmentCounts: [{ segment: 'vip', count: 2 }, { segment: 'regular', count: 5 }], source: 'ai', pastCampaignCount: 0, reviewTotal: 0, competitorCount: 0 });
  const b = hashSimulationInput({ draft: DRAFT, segmentCounts: [{ segment: 'regular', count: 5 }, { segment: 'vip', count: 2 }], source: 'ai', pastCampaignCount: 0, reviewTotal: 0, competitorCount: 0 });
  assert.equal(a, b);
  assert.equal(a, hashSimulationInput({ draft: DRAFT, segmentCounts: [{ segment: 'vip', count: 2 }, { segment: 'regular', count: 5 }], source: 'ai', pastCampaignCount: 0, reviewTotal: 0, competitorCount: 0 }));
});

test('hashSimulationInput changes when the draft message changes', () => {
  const base = hashSimulationInput({ draft: DRAFT, segmentCounts: [], source: 'ai', pastCampaignCount: 0, reviewTotal: 0, competitorCount: 0 });
  const changed = hashSimulationInput({ draft: { ...DRAFT, message: 'improved text' }, segmentCounts: [], source: 'ai', pastCampaignCount: 0, reviewTotal: 0, competitorCount: 0 });
  const segmentChanged = hashSimulationInput({ draft: DRAFT, segmentCounts: [{ segment: 'vip', count: 9 }], source: 'ai', pastCampaignCount: 0, reviewTotal: 0, competitorCount: 0 });
  const sourceChanged = hashSimulationInput({ draft: DRAFT, segmentCounts: [], source: 'demo', pastCampaignCount: 0, reviewTotal: 0, competitorCount: 0 });
  assert.notEqual(base, changed);
  assert.notEqual(base, segmentChanged);
  assert.notEqual(base, sourceChanged);
});

// ---------------------------------------------------------------------------
// runSimulation — the two paths and the honest failure
// ---------------------------------------------------------------------------

let hadGroq: string | undefined;
let hadGemini: string | undefined;

beforeEach(() => {
  hadGroq = process.env.GROQ_API_KEY;
  hadGemini = process.env.GOOGLE_GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.GOOGLE_GEMINI_API_KEY;
});

afterEach(() => {
  if (hadGroq !== undefined) process.env.GROQ_API_KEY = hadGroq;
  if (hadGemini !== undefined) process.env.GOOGLE_GEMINI_API_KEY = hadGemini;
});

test('demo mode returns the deterministic forecast, tagged demo', async () => {
  const outcome = await runSimulation(CTX, { mode: 'demo' });
  assert.equal(outcome.status, 'complete');
  assert.equal(outcome.source, 'demo');
  assert.equal(outcome.model, 'demo:deterministic');
  assert.ok(outcome.forecast);
  // matches the pure generator — no hidden state
  assert.deepEqual(outcome.forecast, generateDemoForecast(CTX));
});

test('live mode with no AI key returns honest unavailable — no scores, nothing sent', async () => {
  const outcome = await runSimulation(CTX, { mode: 'live' });
  assert.equal(outcome.status, 'unavailable');
  assert.equal(outcome.forecast, null);
  assert.equal(outcome.reason, SIMULATION_UNAVAILABLE_MESSAGE);
});

test('live mode with a failing provider returns unavailable (not a fake forecast)', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const outcome = await runSimulation(CTX, {
    mode: 'live',
    generate: async () => new Response('down', { status: 503 }),
  });
  assert.equal(outcome.status, 'unavailable');
  assert.equal(outcome.forecast, null);
  assert.match(outcome.reason ?? '', /unavailable/i);
});

test('live mode PII tripwire: a phone inside the synthesized context blocks the run', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const poisoned: SimulationContext = {
    ...CTX,
    segmentSummaries: [
      // @ts-expect-error deliberately smuggling a phone into the aggregate layer
      { segment: 'vip', count: 2, note: 'call +27821113333' },
    ],
  };
  const outcome = await runSimulation(poisoned, { mode: 'live' });
  assert.equal(outcome.status, 'unavailable');
  assert.equal(outcome.forecast, null);
});

test('the owner typing their own restaurant number in the draft does NOT block the run', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const ownNumberDraft: SimulationContext = {
    ...CTX,
    draft: { ...CTX.draft, message: 'Join us Thursday — book on 011 555 1234. R299 for two.' },
  };
  // the PII guard protects synthesized aggregates, not the owner's own public
  // campaign text — this must reach the provider (and fail only because the
  // fake fetch below is unreachable in this sandbox… so assert it was called).
  let called = false;
  const outcome = await runSimulation(ownNumberDraft, {
    mode: 'live',
    generate: async () => {
      called = true;
      throw new Error('offline');
    },
  });
  assert.equal(called, true, 'provider should have been called for owner text');
  assert.equal(outcome.status, 'unavailable'); // offline provider → honest state
});

test('the disclaimer constant is exactly the required owner-facing wording', () => {
  assert.equal(FORECAST_DISCLAIMER, 'Forecast only. Real results are measured after launch.');
});
