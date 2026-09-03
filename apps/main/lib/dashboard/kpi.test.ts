import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * GATE UI-3R / F1 + F3 + F5 + F7 — pure KPI copy decisions.
 *
 * Failing-first: none of these helpers exist on the unmodified branch; the
 * Overview/Analytics pages hardcode their subtexts, badges and empty states,
 * which is exactly how S1–S5 and S7 happened.
 */

describe('F1 — AI Bookings card: number and subtext from ONE source', () => {
  test('S1: zero bookings yields an honest zero subtext, never "N tables booked today"', async () => {
    const { aiBookingsCard } = await import('./kpi.ts');
    assert.equal(aiBookingsCard(0).subtext, 'No tables booked yet today');
  });

  test('S1: four bookings show a matching subtext (number and subtext agree)', async () => {
    const { aiBookingsCard } = await import('./kpi.ts');
    const card = aiBookingsCard(4);
    assert.equal(card.value, 4);
    assert.match(card.subtext, /4 tables booked today/);
  });

  test('wiring rule: subtext NEVER claims activity when the value is 0', async () => {
    const { aiBookingsCard } = await import('./kpi.ts');
    const subtext = aiBookingsCard(0).subtext.toLowerCase();
    assert.ok(
      !/table|booked|guest/.test(subtext.replace(/no tables booked yet today/, '')),
      `subtext "${subtext}" must not claim activity at zero`
    );
  });
});

describe('F1/S5 — Verified Revenue week-on-week badge shows a real % or nothing', () => {
  test('S5: both weeks at zero renders NO badge at all (no arrow without a number)', async () => {
    const { revenueWowBadge } = await import('./kpi.ts');
    assert.equal(revenueWowBadge(0, 0), null);
  });

  test('no previous week (no baseline) renders no badge', async () => {
    const { revenueWowBadge } = await import('./kpi.ts');
    assert.equal(revenueWowBadge(50000, 0), null);
  });

  test('a real change renders a badge with a numeric percentage', async () => {
    const { revenueWowBadge } = await import('./kpi.ts');
    const badge = revenueWowBadge(150000, 100000);
    assert.ok(badge, 'badge expected');
    assert.equal(badge.pct, 50);
    assert.equal(badge.direction, 'up');
  });

  test('a decline renders a down badge with the real magnitude', async () => {
    const { revenueWowBadge } = await import('./kpi.ts');
    const badge = revenueWowBadge(50000, 100000);
    assert.ok(badge, 'badge expected');
    assert.equal(badge.pct, -50);
    assert.equal(badge.direction, 'down');
  });
});

describe('F3 — 7-day revenue chart empty state', () => {
  test('S3: an all-zero series is reported as having no data', async () => {
    const { revenueChartHasData } = await import('./kpi.ts');
    assert.equal(revenueChartHasData([0, 0, 0, 0, 0, 0, 0]), false);
  });

  test('any non-zero day means the chart has data', async () => {
    const { revenueChartHasData } = await import('./kpi.ts');
    assert.equal(revenueChartHasData([0, 0, 0, 12000, 0, 0, 0]), true);
  });

  test('the honest empty-state copy is the one the owner specified', async () => {
    const { EMPTY_REVENUE_CHART_MESSAGE } = await import('./kpi.ts');
    assert.equal(
      EMPTY_REVENUE_CHART_MESSAGE,
      'No verified revenue yet — it appears after your first WhatsApp booking.'
    );
  });
});

describe('F7 — "n unanswered" wording', () => {
  test('S4: the badge says "unanswered", not "need attention"', async () => {
    const { unansweredBadge } = await import('./kpi.ts');
    assert.equal(unansweredBadge(5), '5 unanswered');
  });

  test('singular grammar for one unanswered review', async () => {
    const { unansweredBadge } = await import('./kpi.ts');
    assert.equal(unansweredBadge(1), '1 unanswered');
  });

  test('zero unanswered renders NO badge (nothing to say)', async () => {
    const { unansweredBadge } = await import('./kpi.ts');
    assert.equal(unansweredBadge(0), null);
  });
});

describe('F5 — Customers honest zero-states', () => {
  test('S7: zero profiles must NOT celebrate retention', async () => {
    const { customersAtRiskEmptyState } = await import('./kpi.ts');
    const copy = customersAtRiskEmptyState(0);
    assert.equal(copy, 'No guests yet — they appear after their first booking.');
  });

  test('guests exist but none at risk is genuine good news', async () => {
    const { customersAtRiskEmptyState } = await import('./kpi.ts');
    const copy = customersAtRiskEmptyState(42);
    assert.match(copy, /at-risk/i);
    assert.ok(!/Great retention/.test(copy) || /42/.test(copy), 'if retention is claimed, the guest count must justify it');
  });

  test('S8: a zero-percentage segment renders a dash, not a 0% bar', async () => {
    const { segmentShare } = await import('./kpi.ts');
    assert.equal(segmentShare(0, 0), null);
    assert.equal(segmentShare(0, 57), null);
    assert.equal(segmentShare(19, 57), 33);
  });
});

describe('F2 — SAMPLE chip decision', () => {
  test('demo mode marks affected KPIs as sample data', async () => {
    const { sampleChipLabel } = await import('./kpi.ts');
    assert.equal(sampleChipLabel(true), 'SAMPLE');
    assert.equal(sampleChipLabel(false), null);
  });
});

describe('QA-2 — 7-day revenue strip bucketing (one query, no N+1)', () => {
  const DAY = 24 * 3600 * 1000;
  // A fixed midnight; en-ZA weekday labels are locale-stable for the asserts.
  const startOfToday = new Date('2026-09-03T00:00:00');

  test('one event per day lands in the correct bucket, oldest day first', async () => {
    const { sevenDayRevenueBuckets } = await import('./kpi.ts');
    const rows = [6, 5, 4, 3, 2, 1, 0].map((daysAgo) => ({
      occurredAt: new Date(startOfToday.getTime() - daysAgo * DAY + 12 * 3600 * 1000),
      realizedCents: (7 - daysAgo) * 100,
    }));
    const bars = sevenDayRevenueBuckets(rows, startOfToday);
    assert.equal(bars.length, 7);
    assert.deepEqual(
      bars.map((b) => b.value),
      [100, 200, 300, 400, 500, 600, 700]
    );
  });

  test('an event exactly at a day boundary belongs to the LATER day ([start, end) semantics)', async () => {
    const { sevenDayRevenueBuckets } = await import('./kpi.ts');
    // Midnight exactly = startOfToday: yesterday's window is [−24h, 0),
    // today's is [0, +24h) — the event must land in TODAY.
    const bars = sevenDayRevenueBuckets(
      [{ occurredAt: new Date(startOfToday.getTime()), realizedCents: 500 }],
      startOfToday
    );
    assert.equal(bars[6].value, 500);
    assert.equal(bars[5].value, 0);
  });

  test('an event one millisecond before midnight stays in the EARLIER day', async () => {
    const { sevenDayRevenueBuckets } = await import('./kpi.ts');
    const bars = sevenDayRevenueBuckets(
      [{ occurredAt: new Date(startOfToday.getTime() - 1), realizedCents: 500 }],
      startOfToday
    );
    assert.equal(bars[5].value, 500);
    assert.equal(bars[6].value, 0);
  });

  test('an empty week renders seven honest zero bars with weekday labels', async () => {
    const { sevenDayRevenueBuckets } = await import('./kpi.ts');
    const bars = sevenDayRevenueBuckets([], startOfToday);
    assert.equal(bars.length, 7);
    assert.ok(bars.every((b) => b.value === 0));
    assert.ok(bars.every((b) => typeof b.label === 'string' && b.label.length >= 3));
    // Oldest first: the first label is 6 days ago's weekday, the last is today's.
    const sixDaysAgo = new Date(startOfToday.getTime() - 6 * DAY);
    assert.equal(bars[0].label, sixDaysAgo.toLocaleDateString('en-ZA', { weekday: 'short' }));
    assert.equal(bars[6].label, startOfToday.toLocaleDateString('en-ZA', { weekday: 'short' }));
  });

  test('NULL realizedCents contributes nothing (SQL SUM semantics preserved)', async () => {
    const { sevenDayRevenueBuckets } = await import('./kpi.ts');
    const noon = 12 * 3600 * 1000;
    const bars = sevenDayRevenueBuckets(
      [
        { occurredAt: new Date(startOfToday.getTime() + noon), realizedCents: null },
        { occurredAt: new Date(startOfToday.getTime() + noon), realizedCents: 250 },
      ],
      startOfToday
    );
    assert.equal(bars[6].value, 250);
  });

  test('rows outside the 7-day window are ignored (older or future)', async () => {
    const { sevenDayRevenueBuckets } = await import('./kpi.ts');
    const bars = sevenDayRevenueBuckets(
      [
        { occurredAt: new Date(startOfToday.getTime() - 7 * DAY), realizedCents: 999 }, // too old
        { occurredAt: new Date(startOfToday.getTime() + 3 * DAY), realizedCents: 999 }, // future
      ],
      startOfToday
    );
    assert.ok(bars.every((b) => b.value === 0));
  });

  test('occurredAt as an ISO string (serialized row) buckets identically to a Date', async () => {
    const { sevenDayRevenueBuckets } = await import('./kpi.ts');
    const at = new Date(startOfToday.getTime() - 2 * DAY + 3600 * 1000);
    const byDate = sevenDayRevenueBuckets([{ occurredAt: at, realizedCents: 100 }], startOfToday);
    const byString = sevenDayRevenueBuckets(
      [{ occurredAt: at.toISOString(), realizedCents: 100 }],
      startOfToday
    );
    assert.deepEqual(byString, byDate);
  });
});
