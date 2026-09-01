import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * GATE UI-3R / F7 — Rand formatting everywhere, no raw decimals, no "$" icon.
 *
 * Owner-verified symptoms (S14): "25 000" and "3571.4" rendered raw; the
 * revenue card used a DollarSign icon on a Rand product. Failing-first: this
 * module does not exist on the unmodified branch.
 */

describe('F7 — formatRand', () => {
  test('S14: cents render as a Rand amount with R prefix and thousands separators', async () => {
    const { formatRand } = await import('./rand.ts');
    assert.equal(formatRand(2_500_000), 'R25,000');
    assert.equal(formatRand(357_140), 'R3,571');
  });

  test('zero renders as R0 (honest zero, still Rand-formatted)', async () => {
    const { formatRand } = await import('./rand.ts');
    assert.equal(formatRand(0), 'R0');
  });

  test('no raw decimals: cents are rounded to whole Rand', async () => {
    const { formatRand } = await import('./rand.ts');
    assert.ok(!formatRand(123_456).includes('.'), 'must not render decimals');
    assert.equal(formatRand(199), 'R2');
  });

  test('large values keep grouping separators', async () => {
    const { formatRand } = await import('./rand.ts');
    assert.equal(formatRand(123_456_789), 'R1,234,568'); // R1,234,567.89 rounds up
  });
});

describe('F7 — engine-aware value formatting (Analytics KPI cards)', () => {
  test('the revenue engine formats its total as Rand', async () => {
    const { formatEngineTotal } = await import('./rand.ts');
    assert.equal(formatEngineTotal('revenue', 2_500_000), 'R25,000');
  });

  test('count engines (conversations, reviews...) format as counts', async () => {
    const { formatEngineTotal } = await import('./rand.ts');
    assert.equal(formatEngineTotal('operations', 1234), '1,234');
    assert.equal(formatEngineTotal('reputation', 42), '42');
  });

  test('moving averages: revenue renders as Rand, counts render without raw decimals', async () => {
    const { formatMa } = await import('./rand.ts');
    assert.equal(formatMa('revenue', 357_140), 'R3,571');
    assert.equal(formatMa('operations', 3571.423), '3,571');
    assert.equal(formatMa('reputation', 0), '0');
  });
});

describe('F7 — trend badges show a real % or render nothing', () => {
  test('S15: a null percentage renders NOTHING (not "↑ —")', async () => {
    const { trendBadgeLabel } = await import('./rand.ts');
    assert.equal(trendBadgeLabel(null), null);
  });

  test('a real percentage renders with sign', async () => {
    const { trendBadgeLabel } = await import('./rand.ts');
    assert.equal(trendBadgeLabel(12.34), '+12.3%');
    assert.equal(trendBadgeLabel(-7.26), '-7.3%');
    assert.equal(trendBadgeLabel(0), '0.0%');
  });
});
