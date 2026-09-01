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
