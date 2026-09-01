/**
 * GATE UI-3R — pure KPI copy decisions for the dashboard's headline numbers.
 *
 * Every helper here exists because an owner-verified symptom traced back to a
 * display decision made inline in JSX with no single source of truth:
 *
 *   S1  "AI BOOKINGS 0" next to "4 tables booked today" — two numbers from
 *       two queries fighting each other (F1: single-source).
 *   S2/S5 R500 "verified revenue" + a "week on week" arrow with no number
 *       while disconnected (F1: real % or nothing).
 *   S3  a 7-day chart of bare day labels with no bars and no empty state
 *       (F3: explicit honest message).
 *   S4  "5 need attention" — unclear next to 0 negative (F7: "n unanswered").
 *   S7  "Great retention!" celebrating an empty room (F5: honest zero-state).
 *   S8  0% progress bars reading as gold data lines (F5: render nothing).
 *
 * All functions are pure so they can be unit-tested without a database —
 * the wiring tests pin that the pages actually call them.
 */

/** F1 — the AI Bookings card derives its number AND subtext from one query. */
export function aiBookingsCard(count: number): { value: number; subtext: string } {
  return {
    value: count,
    subtext: count > 0 ? `${count} table${count === 1 ? '' : 's'} booked today` : 'No tables booked yet today',
  };
}

export interface TrendBadge {
  pct: number;
  direction: 'up' | 'down';
}

/**
 * F1/S5 — the week-on-week badge for Verified Revenue. Returns null when
 * there is no honest percentage to show (no baseline, or nothing at all
 * yet) — the caller must render NOTHING in that case, never a bare arrow.
 */
export function revenueWowBadge(thisWeekCents: number, lastWeekCents: number): TrendBadge | null {
  if (lastWeekCents <= 0) return null; // no baseline → no claim
  if (thisWeekCents <= 0 && lastWeekCents <= 0) return null; // nothing ever happened
  const pct = Math.round(((thisWeekCents - lastWeekCents) / lastWeekCents) * 100);
  return { pct, direction: pct >= 0 ? 'up' : 'down' };
}

/** F3 — does the 7-day revenue strip have anything real to draw? */
export function revenueChartHasData(bars: readonly number[]): boolean {
  return bars.some((value) => value > 0);
}

export const EMPTY_REVENUE_CHART_MESSAGE =
  'No verified revenue yet — it appears after your first WhatsApp booking.';

/** F7 — "{n} unanswered" (count = reviews without a sent response). */
export function unansweredBadge(count: number): string | null {
  if (count <= 0) return null;
  return `${count} unanswered`;
}

/**
 * F5 — Customers at-risk empty state. With ZERO profiles the honest message
 * is "no guests yet" (they appear after their first booking); with guests
 * but none at risk, retention genuinely is worth a friendly word.
 */
export function customersAtRiskEmptyState(totalProfiles: number): string {
  if (totalProfiles <= 0) return 'No guests yet — they appear after their first booking.';
  return `No at-risk customers right now across your ${totalProfiles} guests — regulars are visiting as expected.`;
}

/**
 * F5/S8 — a segment's share of the guest book. Zero-count segments render
 * NO percentage and NO bar (null), because a gold 0% line reads as data.
 */
export function segmentShare(count: number, total: number): number | null {
  if (count <= 0 || total <= 0) return null;
  return Math.round((count / total) * 100);
}

/** F2 — the "SAMPLE" chip label shown on KPIs while demo mode is on. */
export function sampleChipLabel(demoMode: boolean): string | null {
  return demoMode ? 'SAMPLE' : null;
}
