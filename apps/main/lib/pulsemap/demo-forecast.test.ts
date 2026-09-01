import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoForecast, readinessFromScore } from './demo-forecast.ts';
import type { SimulationContext, SegmentSummary } from './types.ts';

const SEGMENTS: SegmentSummary[] = [
  { segment: 'vip', count: 90, avgVisits: 14, avgSpendCents: 260000, avgDaysSinceLastVisit: 25 },
  { segment: 'regular', count: 380, avgVisits: 8, avgSpendCents: 110000, avgDaysSinceLastVisit: 40 },
  { segment: 'at_risk', count: 140, avgVisits: 5, avgSpendCents: 70000, avgDaysSinceLastVisit: 150 },
  { segment: 'dormant', count: 240, avgVisits: 3, avgSpendCents: 45000, avgDaysSinceLastVisit: 260 },
  { segment: 'new', count: 8, avgVisits: 1, avgSpendCents: 35000, avgDaysSinceLastVisit: 20 },
];

function makeCtx(message: string, targetSegment: string | null = 'regular'): SimulationContext {
  return {
    draft: {
      title: 'Thursday Date Night',
      message,
      offer: 'R299 for two',
      targetSegment,
      sendAt: '2026-09-03T18:00:00.000Z',
    },
    restaurant: { name: 'The Grand Bistro', description: 'A warm bistro.', openingHours: 'Mon-Sun 11:30-22:00' },
    segmentSummaries: SEGMENTS.map((s) => ({ ...s })),
    pastCampaigns: [
      { name: 'Winter Reactivation', status: 'sent', targetSegment: 'at_risk', sentCount: 140, estimatedReach: 140, estimatedRevenueCents: 180000 },
    ],
    reviewSignal: { totalReviews: 312, avgRating: 4.6, themes: ['steak', 'service'] },
    marketSignal: { competitorCount: 6, avgCompetitorRating: 4.2, activePromotions: 3 },
  };
}

test('demo forecast is deterministic — same input, identical output', () => {
  const a = generateDemoForecast(makeCtx('R299 date-night meal for two this Thursday — 3 courses, menu included. Reply BOOK and we will sort your table.'));
  const b = generateDemoForecast(makeCtx('R299 date-night meal for two this Thursday — 3 courses, menu included. Reply BOOK and we will sort your table.'));
  assert.deepEqual(a, b);
});

test('demo forecast scores within 0-100 and covers every segment', () => {
  const forecast = generateDemoForecast(makeCtx('R299 date-night meal for two this Thursday — 3 courses, menu included. Reply BOOK and we will sort your table.'));
  assert.ok(forecast.score >= 0 && forecast.score <= 100);
  assert.equal(forecast.segmentReactions.length, 5);
  for (const r of forecast.segmentReactions) {
    assert.ok(r.purchaseIntent >= 0 && r.purchaseIntent <= 100, `intent out of range for ${r.segment}`);
    assert.ok(r.reaction.length > 10, `reaction too thin for ${r.segment}`);
  }
});

test('a concrete, complete message scores higher than a vague one', () => {
  const good = generateDemoForecast(
    makeCtx('R299 date-night meal for two this Thursday — 3 courses, menu included. Limited tables. Reply BOOK and we will sort your table.')
  );
  const vague = generateDemoForecast(makeCtx('Come eat with us sometime, we have nice food.'));
  assert.ok(good.score > vague.score, `expected ${good.score} > ${vague.score}`);
});

test('demo forecast is honestly labelled as demo', () => {
  const forecast = generateDemoForecast(makeCtx('R299 date-night meal for two this Thursday — 3 courses, menu included. Reply BOOK and we will sort your table.'));
  assert.equal(forecast.confidence, 'low');
  assert.match(forecast.explanation, /DEMO FORECAST/i);
  assert.ok(forecast.assumptions.some((a) => /sample dataset/i.test(a)));
  assert.ok(forecast.assumptions.some((a) => /does not promise/i.test(a)));
});

test('demo forecast never guarantees behaviour', () => {
  const forecast = generateDemoForecast(makeCtx('R299 date-night meal for two this Thursday — 3 courses, menu included. Reply BOOK and we will sort your table.'));
  const allText = JSON.stringify(forecast);
  assert.doesNotMatch(allText, /guarantee[sd]?\b/i);
});

test('reactions reference the real segment counts from the sample data', () => {
  const forecast = generateDemoForecast(makeCtx('R299 date-night for two this Thursday — menu included. Reply BOOK.'));
  const regular = forecast.segmentReactions.find((r) => r.segment === 'regular')!;
  assert.match(regular.reaction, /380 regulars/);
  const dormant = forecast.segmentReactions.find((r) => r.segment === 'dormant')!;
  assert.match(dormant.reaction, /240 dormant guests/);
});

test('missing-price drafts produce a price objection and a "how much" reply', () => {
  const forecast = generateDemoForecast(makeCtx('Join us this Thursday for a lovely dinner — reply BOOK.'));
  assert.ok(forecast.objections.some((o) => /price is unclear/i.test(o)));
  assert.ok(forecast.likelyReplies.some((r) => /how much/i.test(r)));
});

test('improved copy is always produced and is non-empty', () => {
  const forecast = generateDemoForecast(makeCtx('Food.'));
  assert.ok(forecast.improvedCopy.trim().length >= 20);
});

test('readiness thresholds map correctly', () => {
  assert.equal(readinessFromScore(90), 'ready');
  assert.equal(readinessFromScore(72), 'ready');
  assert.equal(readinessFromScore(71), 'improve');
  assert.equal(readinessFromScore(50), 'improve');
  assert.equal(readinessFromScore(49), 'rework');
});
