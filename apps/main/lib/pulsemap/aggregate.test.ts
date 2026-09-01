import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSegments, detectPII, assertContextIsPIIFree } from './aggregate.ts';

test('summarizeSegments returns every known segment, including zeroes', () => {
  const summaries = summarizeSegments([], new Date('2026-09-01T00:00:00Z'));
  assert.equal(summaries.length, 5);
  assert.deepEqual(summaries.map((s) => s.segment), ['vip', 'regular', 'at_risk', 'dormant', 'new']);
  for (const s of summaries) {
    assert.equal(s.count, 0);
    assert.equal(s.avgVisits, 0);
    assert.equal(s.avgSpendCents, 0);
    assert.equal(s.avgDaysSinceLastVisit, null);
  }
});

test('summarizeSegments aggregates counts and averages per segment', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const rows = [
    { segment: 'vip', totalVisits: 10, totalSpendCents: 200000, lastVisitAt: new Date('2026-08-12T00:00:00Z') },
    { segment: 'vip', totalVisits: 8, totalSpendCents: 120000, lastVisitAt: null },
    { segment: 'regular', totalVisits: '6', totalSpendCents: '90000', lastVisitAt: '2026-08-16T00:00:00Z' },
    { segment: 'who-knows', totalVisits: 99, totalSpendCents: 999999, lastVisitAt: new Date() },
  ];
  const summaries = summarizeSegments(rows, now);
  const vip = summaries.find((s) => s.segment === 'vip')!;
  const regular = summaries.find((s) => s.segment === 'regular')!;
  assert.equal(vip.count, 2);
  assert.equal(vip.avgVisits, 9);
  assert.equal(vip.avgSpendCents, 160000);
  assert.equal(vip.avgDaysSinceLastVisit, 20); // one dated row: 20 days
  assert.equal(regular.count, 1);
  assert.equal(regular.avgVisits, 6);
  // unknown segments are dropped, not guessed into a bucket
  assert.equal(summaries.find((s) => (s.segment as string) === 'who-knows'), undefined);
});

test('detectPII catches phone numbers in common SA formats', () => {
  assert.equal(detectPII('+27825551234').hasPII, true);
  assert.equal(detectPII('call 082 555 1234 now').hasPII, true);
  assert.equal(detectPII('0711234567').hasPII, true);
});

test('detectPII catches emails and handles', () => {
  const d = detectPII('guest lerato@example.com said hi');
  assert.equal(d.hasPII, true);
  assert.ok(d.matches.some((m) => m.includes('@')));
});

test('detectPII passes clean aggregate data', () => {
  const clean = JSON.stringify({
    segments: [
      { segment: 'vip', count: 90, avgVisits: 14, avgSpendCents: 260000, avgDaysSinceLastVisit: 25 },
      { segment: 'regular', count: 380, avgVisits: 8, avgSpendCents: 110000, avgDaysSinceLastVisit: 40 },
    ],
    themes: ['steak', 'service', 'vibe'],
  });
  assert.equal(detectPII(clean).hasPII, false);
});

test('assertContextIsPIIFree throws when a phone slips into synthesized context', () => {
  assert.throws(
    () => assertContextIsPIIFree({ note: 'guest on +27821112222' }),
    /PII guard tripped/,
  );
  // clean context passes
  assert.doesNotThrow(() => assertContextIsPIIFree({ count: 5, avg: 12 }));
});

test('numeric-looking non-PII does not false-positive', () => {
  // amounts, dates and versions must not be flagged as phone numbers
  assert.equal(detectPII('R2,600 avg spend, 2026-09-01, v1.2.3, 3.14159').hasPII, false);
});
