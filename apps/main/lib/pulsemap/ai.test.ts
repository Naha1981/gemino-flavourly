import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateForecastWithAI, validateForecast } from './ai.ts';
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

const GOOD_FORECAST = {
  score: 71,
  readiness: 'improve',
  bestSegment: 'regular',
  purchaseIntent: 'Most regulars will engage.',
  objections: ['Price unclear'],
  likelyReplies: ['How much is it?'],
  riskFlags: [],
  improvedCopy: 'The Grand Bistro · Thursday\nR299 for two, menu included. Reply BOOK.',
  explanation: 'Concrete offer, clear day, good fit with regulars.',
  confidence: 'medium',
  assumptions: ['Thin data'],
  segmentReactions: [
    { segment: 'regular', reaction: 'Strong fit', purchaseIntent: 74, primaryObjection: null },
    { segment: 'vip', reaction: 'Fine', purchaseIntent: 52, primaryObjection: 'Feels discount-led' },
  ],
};

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

// ---------------------------------------------------------------------------
// validateForecast — the contract the LLM output must satisfy
// ---------------------------------------------------------------------------

test('a valid forecast passes with all fields intact', () => {
  const f = validateForecast(GOOD_FORECAST, CTX);
  assert.ok(f);
  assert.equal(f.score, 71);
  assert.equal(f.readiness, 'improve');
  assert.equal(f.bestSegment, 'regular');
  assert.equal(f.segmentReactions.length, 2);
});

test('missing hard fields reject the whole forecast (no half-fabrications)', () => {
  assert.equal(validateForecast({ ...GOOD_FORECAST, improvedCopy: '' }, CTX), null);
  assert.equal(validateForecast({ ...GOOD_FORECAST, explanation: 'x' }, CTX), null);
  assert.equal(validateForecast({ ...GOOD_FORECAST, score: 'not-a-number' }, CTX), null);
  assert.equal(validateForecast({ ...GOOD_FORECAST, segmentReactions: [] }, CTX), null);
  assert.equal(validateForecast('not an object', CTX), null);
});

test('numbers are clamped to 0-100 and safe defaults derive for soft fields', () => {
  const f = validateForecast(
    {
      ...GOOD_FORECAST,
      score: 250,
      readiness: 'bogus',
      bestSegment: 'not-a-segment',
      confidence: 'whatever',
      segmentReactions: [{ segment: 'regular', reaction: 'ok', purchaseIntent: 9999 }],
    },
    CTX,
  )!;
  assert.equal(f.score, 100);
  assert.equal(f.readiness, 'ready'); // derived from clamped score
  assert.equal(f.bestSegment, 'regular'); // derived from max intent
  assert.equal(f.confidence, 'low'); // safe default
  assert.equal(f.segmentReactions[0].purchaseIntent, 100);
});

test('segments the model skipped get an honest unknown placeholder', () => {
  const f = validateForecast(
    { ...GOOD_FORECAST, segmentReactions: [{ segment: 'vip', reaction: 'ok', purchaseIntent: 40 }] },
    CTX,
  )!;
  const regular = f.segmentReactions.find((r) => r.segment === 'regular')!;
  assert.match(regular.reaction, /did not assess/i);
  assert.equal(regular.purchaseIntent, 0);
});

// ---------------------------------------------------------------------------
// generateForecastWithAI — provider chain honesty
// ---------------------------------------------------------------------------

function groqResponse(forecast: object) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(forecast) } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('no configured key → null (never a fabricated forecast)', async () => {
  const result = await generateForecastWithAI(CTX, async () => {
    throw new Error('must not be called without a key');
  });
  assert.equal(result, null);
});

test('a good Groq response parses, validates, and is tagged with its model', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const result = await generateForecastWithAI(CTX, async (url) => {
    assert.match(url, /api\.groq\.com/);
    return groqResponse(GOOD_FORECAST);
  });
  assert.ok(result);
  assert.equal(result.model, 'groq:openai/gpt-oss-20b');
  assert.equal(result.forecast.score, 71);
});

test('markdown-fenced JSON is still parsed', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const fenced = new Response(
    JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(GOOD_FORECAST) + '\n```' } }] }),
    { status: 200 },
  );
  const result = await generateForecastWithAI(CTX, async () => fenced);
  assert.ok(result);
  assert.equal(result.forecast.score, 71);
});

test('provider HTTP failure with no Gemini fallback → null (honest)', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const result = await generateForecastWithAI(CTX, async () => new Response('rate limited', { status: 429 }));
  assert.equal(result, null);
});

test('provider garbage JSON → null (no partial scores)', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const garbage = new Response(JSON.stringify({ choices: [{ message: { content: 'luv ya bye' } }] }), { status: 200 });
  const result = await generateForecastWithAI(CTX, async () => garbage);
  assert.equal(result, null);
});

test('network exception → null, does not throw', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const result = await generateForecastWithAI(CTX, async () => {
    throw new Error('ECONNRESET');
  });
  assert.equal(result, null);
});

test('Gemini fallback is used when Groq fails', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.GOOGLE_GEMINI_API_KEY = 'gemini-key';
  const result = await generateForecastWithAI(CTX, async (url) => {
    if (url.includes('groq.com')) return new Response('boom', { status: 500 });
    assert.match(url, /generativelanguage\.googleapis\.com/);
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(GOOD_FORECAST) }] } }] }),
      { status: 200 },
    );
  });
  assert.ok(result);
  assert.equal(result.model, 'gemini:gemini-3.5-flash');
});
