import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comparePeriods,
  movingAverage,
  lastMovingAverage,
  linearRegression,
  forecastRevenue,
  cohortRetention,
  summarizeDailySeries,
  buildOverview,
} from './engine.ts';

describe('comparePeriods', () => {
  test('computes delta, pct and direction', () => {
    const r = comparePeriods(120, 100);
    assert.equal(r.delta, 20);
    assert.ok(Math.abs((r.pctChange ?? 0) - 20) < 1e-9);
    assert.equal(r.direction, 'up');
  });

  test('handles decline and flat', () => {
    assert.equal(comparePeriods(80, 100).direction, 'down');
    assert.equal(comparePeriods(100, 100).direction, 'flat');
  });

  test('pct is null when previous is zero (avoids divide-by-zero)', () => {
    assert.equal(comparePeriods(50, 0).pctChange, null);
  });
});

describe('movingAverage', () => {
  test('trails and never throws on short input', () => {
    assert.deepEqual(movingAverage([10, 20, 30], 2), [10, 15, 25]);
    assert.deepEqual(movingAverage([5], 7), [5]);
    assert.equal(lastMovingAverage([], 7), null);
  });

  test('lastMovingAverage reflects the trailing window', () => {
    assert.equal(lastMovingAverage([1, 2, 3, 4], 4), 2.5);
    assert.equal(lastMovingAverage([1, 2, 3, 4], 7), 2.5);
  });
});

describe('linearRegression', () => {
  test('fits a perfect line', () => {
    const fit = linearRegression([0, 1, 2, 3], [2, 4, 6, 8]);
    assert.ok(Math.abs(fit.slope - 2) < 1e-9);
    assert.ok(Math.abs(fit.intercept - 2) < 1e-9);
    assert.ok(Math.abs(fit.r2 - 1) < 1e-9);
  });

  test('degrades gracefully with <2 points', () => {
    assert.deepEqual(linearRegression([], []), { slope: 0, intercept: 0, r2: 0 });
    assert.deepEqual(linearRegression([0], [5]), { slope: 0, intercept: 5, r2: 0 });
  });
});

describe('forecastRevenue', () => {
  test('projects a flat series when <2 points', () => {
    const f = forecastRevenue([100], 30);
    assert.equal(f.trend, 'flat');
    assert.equal(f.forecastCents, 3000);
    assert.equal(f.dailyPoints.length, 30);
  });

  test('upward trend forecasts higher than the last observed value', () => {
    const series = [10, 20, 30, 40, 50];
    const f = forecastRevenue(series, 10);
    assert.equal(f.trend, 'up');
    assert.ok(f.forecastCents > 0);
    // Every projected day is clamped at >= 0.
    assert.ok(f.dailyPoints.every((p) => p.cents >= 0));
  });

  test('clamps negative projection days to zero', () => {
    const f = forecastRevenue([100, 80, 60, 40, 20], 10);
    assert.equal(f.trend, 'down');
    assert.ok(f.dailyPoints.every((p) => p.cents >= 0));
  });
});

describe('cohortRetention', () => {
  test('month 0 is 100% and later months reflect returning customers', () => {
    const rows = [
      { firstMonth: '2024-01', customerId: 'a', activeMonth: '2024-01' },
      { firstMonth: '2024-01', customerId: 'a', activeMonth: '2024-02' },
      { firstMonth: '2024-01', customerId: 'b', activeMonth: '2024-01' },
      { firstMonth: '2024-02', customerId: 'c', activeMonth: '2024-02' },
    ];
    const cohorts = cohortRetention(rows);
    const jan = cohorts.find((c) => c.cohortMonth === '2024-01')!;
    assert.equal(jan.cohortSize, 2);
    assert.equal(jan.retention[0], 100);
    // a returned in Feb -> 1 of 2 retained = 50%
    assert.equal(jan.retention[1], 50);
    const feb = cohorts.find((c) => c.cohortMonth === '2024-02')!;
    assert.equal(feb.cohortSize, 1);
    assert.equal(feb.retention[0], 100);
  });

  test('ignores malformed months', () => {
    const cohorts = cohortRetention([{ firstMonth: 'nope', customerId: 'x', activeMonth: '2024-01' }]);
    assert.deepEqual(cohorts, []);
  });
});

describe('summarizeDailySeries', () => {
  const now = new Date('2024-03-31T12:00:00Z');
  const pts = [
    { date: '2024-03-31', value: 10 },
    { date: '2024-03-30', value: 10 },
    { date: '2024-03-29', value: 10 },
    { date: '2024-02-28', value: 5 },
    { date: '2024-02-27', value: 5 },
  ];

  test('computes 30d and 7d windows with deltas', () => {
    const s = summarizeDailySeries('revenue', pts, now);
    // Window is the last 30 days inclusive of today (2024-03-31); Feb 28/27
    // fall outside it, so only Mar 29/30/31 count.
    assert.equal(s.total30, 30);
    assert.equal(s.mom.current, 30);
    assert.equal(s.mom.previous, 10);
    assert.equal(s.trend, 'up');
    // 30-day trailing MA over 30 daily values totalling 30 -> exactly 1.
    assert.equal(s.ma30, 1);
    assert.ok(s.ma7 !== null && s.ma7 > 0);
  });

  test('empty series yields zeroed, flat summary', () => {
    const s = summarizeDailySeries('x', [], now);
    assert.equal(s.total30, 0);
    assert.equal(s.ma7, 0);
    assert.equal(s.trend, 'flat');
  });
});

describe('buildOverview', () => {
  test('wraps engine summaries', () => {
    const o = buildOverview([summarizeDailySeries('revenue', [], new Date())]);
    assert.equal(o.engines.length, 1);
    assert.ok(typeof o.generatedAt === 'string');
  });
});
