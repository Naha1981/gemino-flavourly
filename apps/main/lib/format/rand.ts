/**
 * GATE UI-3R / F7 — Rand formatting everywhere.
 *
 * Symptom (S14): Analytics rendered "25 000" and "3571.4" raw, with a
 * DollarSign icon on a Rand product. This module is the single formatting
 * surface for money on the dashboard:
 *
 *   - R prefix, thousands separators, NO raw decimals (whole Rand)
 *   - engine-aware: only the revenue engine is money; every other engine
 *     (conversations, reviews, campaigns...) is a count
 *   - trend badges show a real percentage or render nothing at all
 */

/** Format a cents amount as whole Rand: 2_500_000 -> "R25,000". */
export function formatRand(cents: number): string {
  const rand = Math.round(cents / 100);
  return `R${rand.toLocaleString('en-US')}`;
}

/**
 * Format a KPI total for an analytics engine. The revenue engine reports
 * cents (SUM(realized_cents)); every other engine reports plain counts.
 */
export function formatEngineTotal(engine: string, value: number): string {
  if (engine === 'revenue') return formatRand(value);
  return value.toLocaleString('en-US');
}

/**
 * Format a moving-average figure. Revenue averages are cents → Rand; count
 * averages lose their raw decimals (3571.4 -> "3,571", never "3571.4").
 */
export function formatMa(engine: string, value: number): string {
  if (engine === 'revenue') return formatRand(value);
  return Math.round(value).toLocaleString('en-US');
}

/**
 * S15 — trend badge label. A null percentage (no baseline) renders NOTHING;
 * the caller must treat null as "do not render the badge".
 */
export function trendBadgeLabel(pct: number | null): string | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}
