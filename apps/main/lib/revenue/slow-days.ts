/**
 * Gate #2 — Slow-Day Detection (Revenue Intelligence Engine).
 *
 * Answers one question per tenant, from data the app already has:
 *
 *   "Which day of the week is currently underperforming its own history,
 *    badly enough that a campaign is worth launching?"
 *
 * Everything here is derived from the existing `reservations` table
 * (`date`, `party_size`) — no new tables, no new cron jobs, no schema
 * changes.
 *
 * ── What "the current week" means, and why ─────────────────────────────
 *
 * The window is the last `WEEK_DAYS` (7) *complete* days, i.e. up to but
 * excluding today. Two alternatives were considered and rejected:
 *
 *  1. Calendar week to date (Monday..today). On a Monday that window is
 *     empty, so the metric — and the morning brief that reports it —
 *     would say nothing at all for the first day of every week.
 *  2. Including today, or future days of this week. Bookings for a future
 *     day arrive progressively (a Friday table is often booked on
 *     Wednesday), so an in-progress or future day is *always* far below
 *     the historical average for that weekday. Flagging it would produce
 *     a false "slow day" alert every single morning — the daily brief
 *     runs at 07:00, when today's same-day bookings are still ~0.
 *
 * A rolling window of 7 complete days contains each weekday exactly once,
 * always with final numbers, and works identically on any day of the
 * week. Because the recommendation ("Launch Tuesday special campaign") is
 * about a recurring weekday pattern rather than one specific date, judging
 * the most recent completed cycle is exactly the right evidence.
 *
 * ── Comparison basis ───────────────────────────────────────────────────
 *
 * The historical average for a weekday is that weekday's average bookings
 * per occurrence over the preceding `HISTORY_DAYS` (90) days, with the
 * current week *excluded* so this week's own dip cannot dampen the
 * baseline it is being measured against.
 *
 * ── Other deliberate choices ───────────────────────────────────────────
 *
 *  - Days are bucketed by UTC calendar date, matching how the rest of the
 *    codebase compares these timestamps directly.
 *  - Cancelled reservations are ignored: a table that was given back is
 *    not demand that failed to show up.
 *  - A weekday is only ever flagged once its historical average clears
 *    `MIN_HISTORICAL_AVERAGE`. At an average of one booking a day, a
 *    single quiet weekday is noise, not a revenue problem, and a new
 *    tenant with a week of data should not be told to launch a campaign.
 *
 * This module has no framework imports (same rule as ./classify.ts and
 * ./cron.ts) so it can be unit-tested directly. The Drizzle adapter lives
 * in ./slow-days-store.ts and is imported by route handlers only.
 */

/** Days of history used to build each weekday's baseline. */
export const HISTORY_DAYS = 90;
/** Length of the "current week" window, in complete days. */
export const WEEK_DAYS = 7;
/** Below this share of the historical average a day is "slow". */
export const SLOW_THRESHOLD = 0.6;
/** Below this share a day is "slow" *and* "critical" (brief-level alert). */
export const CRITICAL_THRESHOLD = 0.5;
/** Ignore weekdays whose historical average is thinner than this. */
export const MIN_HISTORICAL_AVERAGE = 2;

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type SlowDayFlag = 'slow' | 'critical';

/** A reservation row — the subset of the `reservations` table we need. */
export interface ReservationLike {
  tenantId?: string;
  date: Date | string;
  partySize?: number | null;
  status?: string | null;
}

/** Bookings and guests for one calendar day (UTC 'YYYY-MM-DD'). */
export interface DayAggregate {
  day: string | Date;
  bookings: number;
  guests?: number | null;
}

export interface SlowDayOptions {
  /** Reference "now". Defaults to the current time. */
  now?: Date;
  historyDays?: number;
  weekDays?: number;
  /** Share of the historical average below which a day is slow (0.6). */
  threshold?: number;
  /** Share below which a day is additionally critical (0.5). */
  criticalThreshold?: number;
  /** Minimum historical average before a weekday may be flagged at all. */
  minHistoricalAverage?: number;
  /** Count cancelled reservations as demand. Off by default. */
  includeCancelled?: boolean;
}

export interface SlowDayInsight {
  /** Weekday name, e.g. "Tuesday". */
  day: string;
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** The date being judged, 'YYYY-MM-DD' (UTC). */
  date: string;
  currentBookings: number;
  /** Average bookings per occurrence of this weekday over the 90-day history. */
  historicalAvg: number;
  /** Current bookings as a percentage of that average, e.g. "53%". */
  occupancy: string;
  /** Same value as a ratio (0.533), for callers that need to sort/threshold. */
  occupancyRatio: number;
  flags: SlowDayFlag[];
  recommendation: string;
  currentGuests: number;
  currentAvgPartySize: number;
  historicalAvgGuests: number;
  /** Average party size for this weekday over the history window. */
  historicalAvgPartySize: number;
}

export interface SlowDayWindow {
  /** Inclusive start of the current-week window (UTC midnight). */
  weekStart: Date;
  /** Exclusive end of the current-week window: midnight of "today". */
  weekEnd: Date;
  /** Inclusive start of the 90-day history. */
  historyStart: Date;
  /** Exclusive end of the history: equals weekStart. */
  historyEnd: Date;
}

export interface SlowDayReport {
  window: {
    weekStart: string;
    weekEnd: string;
    historyStart: string;
    historyEnd: string;
  };
  /** Every judged day of the current week, oldest first. */
  days: SlowDayInsight[];
  /** Only the flagged days — what the dashboard shows as "slow days". */
  slowDays: SlowDayInsight[];
  /** Only the sub-50% days — what the daily brief escalates. */
  criticalSlowDays: SlowDayInsight[];
}

/**
 * Reads the reservation history for one tenant over one window.
 *
 * `end` is exclusive so callers can pass "midnight today" without picking
 * up an in-progress day. Implemented by ./slow-days-store.ts for Drizzle
 * and by an in-memory fake in the tests.
 */
export interface SlowDayStore {
  findReservations(input: { tenantId: string; start: Date; end: Date }): Promise<ReservationLike[]>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfUtcDay(value: Date | string): Date | null {
  const parsed = typeof value === 'string' ? new Date(value) : new Date(value.getTime());
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

/** UTC 'YYYY-MM-DD' for a Date or ISO string, or null when unparseable. */
export function toDayKey(value: Date | string): string | null {
  const start = startOfUtcDay(value);
  return start ? start.toISOString().slice(0, 10) : null;
}

function utcDayOfWeek(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00.000Z`).getUTCDay();
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function shareOfAverage(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/** The comparison windows for a given "now": this week vs. its 90-day history. */
export function computeSlowDayWindow(
  now: Date = new Date(),
  options: { historyDays?: number; weekDays?: number } = {}
): SlowDayWindow {
  const historyDays = positiveInt(options.historyDays, HISTORY_DAYS);
  const weekDays = positiveInt(options.weekDays, WEEK_DAYS);
  const todayStart = startOfUtcDay(now) ?? new Date();
  const weekStart = new Date(todayStart.getTime() - weekDays * MS_PER_DAY);
  return {
    weekStart,
    weekEnd: todayStart,
    historyStart: new Date(weekStart.getTime() - historyDays * MS_PER_DAY),
    historyEnd: weekStart,
  };
}

/**
 * Fold raw reservation rows into per-day booking/guest counts.
 *
 * Rows with an unparseable date are skipped, as are cancelled rows unless
 * `includeCancelled` is set. `status` is re-checked here even though the
 * Drizzle adapter already filters it, so a caller handing us raw rows
 * (a test, another cron, a backfill script) gets the same answer.
 */
export function toDayAggregates(rows: ReservationLike[], options: SlowDayOptions = {}): DayAggregate[] {
  const byDay = new Map<string, DayAggregate>();

  for (const row of rows) {
    if (!options.includeCancelled && row.status === 'cancelled') continue;
    const key = toDayKey(row.date);
    if (!key) continue;

    const partySize = typeof row.partySize === 'number' && Number.isFinite(row.partySize) && row.partySize > 0
      ? row.partySize
      : 0;
    const bucket = byDay.get(key) ?? { day: key, bookings: 0, guests: 0 };
    bucket.bookings += 1;
    bucket.guests = (bucket.guests ?? 0) + partySize;
    byDay.set(key, bucket);
  }

  return Array.from(byDay.values()).sort((a, b) => String(a.day).localeCompare(String(b.day)));
}

function recommendationFor(
  day: string,
  flags: SlowDayFlag[],
  occupancy: string,
  thinHistory: boolean,
  criticalShare: number
): string {
  if (flags.includes('critical')) {
    return `Launch ${day} special campaign now — under ${Math.round(criticalShare * 100)}% of a normal ${day} (${occupancy} of average)`;
  }
  if (flags.includes('slow')) {
    return `Launch ${day} special campaign`;
  }
  if (thinHistory) {
    return `Not enough ${day} history to recommend a campaign yet`;
  }
  return `No action needed — ${day} is tracking at ${occupancy} of average`;
}

/**
 * Judge each day of the current week against that weekday's 90-day average.
 *
 * Input may be raw reservation rows; use {@link analyzeDayAggregates} when
 * the caller has already grouped them (e.g. the super-admin dashboard,
 * which aggregates across every tenant in SQL).
 */
export function analyzeSlowDays(rows: ReservationLike[], options: SlowDayOptions = {}): SlowDayReport {
  return analyzeDayAggregates(toDayAggregates(rows, options), options);
}

/** {@link analyzeSlowDays} over pre-grouped per-day counts. */
export function analyzeDayAggregates(aggregates: DayAggregate[], options: SlowDayOptions = {}): SlowDayReport {
  const now = options.now ?? new Date();
  const historyDays = positiveInt(options.historyDays, HISTORY_DAYS);
  const weekDays = positiveInt(options.weekDays, WEEK_DAYS);
  const threshold = shareOfAverage(options.threshold, SLOW_THRESHOLD);
  const criticalThreshold = shareOfAverage(options.criticalThreshold, CRITICAL_THRESHOLD);
  const minHistoricalAverage =
    typeof options.minHistoricalAverage === 'number' && Number.isFinite(options.minHistoricalAverage) && options.minHistoricalAverage >= 0
      ? options.minHistoricalAverage
      : MIN_HISTORICAL_AVERAGE;

  const window = computeSlowDayWindow(now, { historyDays, weekDays });
  const weekStartKey = window.weekStart.toISOString().slice(0, 10);
  const weekEndKey = window.weekEnd.toISOString().slice(0, 10);
  const historyStartKey = window.historyStart.toISOString().slice(0, 10);

  const currentByDay = new Map<string, { bookings: number; guests: number }>();
  const historyByDay = new Map<string, { bookings: number; guests: number }>();

  for (const aggregate of aggregates) {
    const key = toDayKey(aggregate.day);
    if (!key) continue;
    const bookings = Number.isFinite(aggregate.bookings) && aggregate.bookings > 0 ? aggregate.bookings : 0;
    const guests = typeof aggregate.guests === 'number' && Number.isFinite(aggregate.guests) && aggregate.guests > 0
      ? aggregate.guests
      : 0;

    if (key >= weekStartKey && key < weekEndKey) {
      currentByDay.set(key, { bookings, guests });
    } else if (key >= historyStartKey && key < weekStartKey) {
      historyByDay.set(key, { bookings, guests });
    }
    // Anything older than the history, or dated today/later, is out of scope.
  }

  // Exact number of times each weekday occurs inside the history window
  // (90 days is 12 full weeks plus 6 days, so the counts differ by one).
  const occurrences = new Array(7).fill(0) as number[];
  const historyByDow = new Array(7).fill(null).map(() => ({ bookings: 0, guests: 0 })) as Array<{
    bookings: number;
    guests: number;
  }>;

  for (let i = 0; i < historyDays; i += 1) {
    occurrences[new Date(window.historyStart.getTime() + i * MS_PER_DAY).getUTCDay()] += 1;
  }
  historyByDay.forEach((totals, key) => {
    const dow = utcDayOfWeek(key);
    historyByDow[dow].bookings += totals.bookings;
    historyByDow[dow].guests += totals.guests;
  });

  const days: SlowDayInsight[] = [];

  for (let i = 0; i < weekDays; i += 1) {
    const date = new Date(window.weekStart.getTime() + i * MS_PER_DAY);
    const key = date.toISOString().slice(0, 10);
    const dow = date.getUTCDay();
    const dayName = DAY_NAMES[dow];

    const current = currentByDay.get(key) ?? { bookings: 0, guests: 0 };
    const historicalBookings = historyByDow[dow].bookings;
    const historicalGuests = historyByDow[dow].guests;
    const divisor = occurrences[dow] || 1;

    const historicalAvg = historicalBookings / divisor;
    const historicalAvgGuests = historicalGuests / divisor;
    const historicalAvgPartySize = historicalBookings > 0 ? historicalGuests / historicalBookings : 0;
    const currentAvgPartySize = current.bookings > 0 ? current.guests / current.bookings : 0;

    const ratio = historicalAvg > 0 ? current.bookings / historicalAvg : 0;
    const occupancyRatio = Math.round(ratio * 1000) / 1000;
    const occupancy = `${Math.round(occupancyRatio * 100)}%`;

    // A weekday with no usable baseline cannot be judged — reporting it as
    // "0% of average" would tell a new tenant to run a campaign it has no
    // evidence for.
    const thinHistory = historicalAvg < minHistoricalAverage;
    const flags: SlowDayFlag[] = [];
    if (!thinHistory) {
      if (ratio < threshold) flags.push('slow');
      if (ratio < criticalThreshold) flags.push('critical');
    }

    days.push({
      day: dayName,
      dayOfWeek: dow,
      date: key,
      currentBookings: current.bookings,
      historicalAvg: round1(historicalAvg),
      occupancy,
      occupancyRatio,
      flags,
      recommendation: recommendationFor(dayName, flags, occupancy, thinHistory, criticalThreshold),
      currentGuests: current.guests,
      currentAvgPartySize: round1(currentAvgPartySize),
      historicalAvgGuests: round1(historicalAvgGuests),
      historicalAvgPartySize: round1(historicalAvgPartySize),
    });
  }

  const slowDays = days.filter((day) => day.flags.length > 0);
  const criticalSlowDays = days.filter((day) => day.flags.includes('critical'));

  return {
    window: {
      weekStart: window.weekStart.toISOString(),
      weekEnd: window.weekEnd.toISOString(),
      historyStart: window.historyStart.toISOString(),
      historyEnd: window.historyEnd.toISOString(),
    },
    days,
    slowDays,
    criticalSlowDays,
  };
}

/**
 * One line of brief copy for a slow day, e.g.
 *
 *   ⚠️ Slow day alert: Tuesday has only 8 bookings (53% of average).
 *   Consider a campaign.
 */
export function formatSlowDayAlert(insight: SlowDayInsight): string {
  return (
    `⚠️ Slow day alert: ${insight.day} has only ${plural(insight.currentBookings, 'booking')} ` +
    `(${insight.occupancy} of average). Consider a campaign.`
  );
}

/**
 * The alerts that belong in the morning brief: only the days below the
 * critical threshold (50%). Days between 50% and 60% are visible on the
 * dashboard but are not worth interrupting an owner's morning over.
 */
export function slowDayAlertLines(insights: SlowDayInsight[]): string[] {
  return insights.filter((insight) => insight.flags.includes('critical')).map(formatSlowDayAlert);
}

/** Total flagged days across several tenant reports (super-admin metric). */
export function totalSlowDays(reports: SlowDayReport[]): number {
  return reports.reduce((sum, report) => sum + report.slowDays.length, 0);
}

/**
 * Full detection pass for one tenant: read the window, then analyse it.
 *
 * This is the single entry point the API route, the daily brief and the
 * super-admin dashboard all go through, so the three surfaces can never
 * disagree about what counts as a slow day.
 */
export async function detectSlowDaysForTenant(
  store: SlowDayStore,
  tenantId: string,
  options: SlowDayOptions = {}
): Promise<SlowDayReport> {
  const now = options.now ?? new Date();
  const window = computeSlowDayWindow(now, options);
  const rows = await store.findReservations({
    tenantId,
    start: window.historyStart,
    end: window.weekEnd,
  });
  return analyzeSlowDays(rows, { ...options, now });
}
