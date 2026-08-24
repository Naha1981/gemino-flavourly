/**
 * Gate #5 — Priority Recommendations (Revenue Intelligence Engine).
 *
 * Gates #1-#4 each found one kind of revenue opportunity: missed enquiries
 * (Gate #1), slow days (Gate #2), cancellations (Gate #3) and no-shows
 * (Gate #4). This gate aggregates the four into one ranked answer for the
 * owner:
 *
 *   "What are the three things most worth doing, right now?"
 *
 * ── The four opportunity types ─────────────────────────────────────────
 *
 *   missed_enquiry — a `revenue_events` row of type 'missed_enquiry' from
 *   the last 7 days with an estimated value. Someone asked for a table and
 *   never got a reply; calling them back is still on the table.
 *
 *   slow_day — a day of the current week the Gate #2 analytics flag as
 *   critical (under 50% of that weekday's own 90-day average). Only the
 *   critical tier counts: a day between 50% and 60% is noise, not an
 *   action, so it is deliberately absent from the priorities.
 *
 *   cancellation — a reservation cancelled in the last 7 days whose
 *   follow-up has not gone out yet (Gate #3's dedup flag is still false).
 *
 *   no_show — a reservation detected as a no-show in the last 7 days
 *   whose follow-up has not gone out yet (Gate #4's dedup flag is still
 *   false).
 *
 * ── The two numbers on every opportunity ───────────────────────────────
 *
 *   estimated_value_cents — the revenue at stake before any probability
 *   adjustment.
 *
 *   priority_score — the value discounted by how likely the action is to
 *   land. This is what the list is sorted on:
 *
 *     missed_enquiry  estimated_value_cents × 0.8      (80% recovery)
 *     slow_day        historicalAvg × historicalAvgPartySize × 4900 × 0.3
 *     cancellation    partySize × 4900 × 0.5           (50% rebook)
 *     no_show         partySize × 4900 × 0.4           (40% rebook)
 *
 *   4900 is the average check (R49).
 *
 * ── Ranking ────────────────────────────────────────────────────────────
 *
 * Sort by priority_score descending. Ties break deterministically —
 * urgency (now → today → this_week), then opportunity type
 * alphabetically, then input order (Array.sort is stable) — so the same
 * data always produces the same top 3. Determinism is what makes the
 * ranking unit-testable and keeps the daily brief from shuffling between
 * runs.
 *
 * ── The store boundary ─────────────────────────────────────────────────
 *
 * The {@link PriorityStore} interface is defined HERE, not in the Drizzle
 * adapter, so the tests can fake it without importing @/lib/db (which
 * throws at import time without DATABASE_URL). The adapter
 * (./priorities-store.ts) implements the three tenant-scoped scans this
 * gate adds: missed enquiries, pending cancellations, pending no-shows.
 * The fourth input — the slow-day report — is the Gate #2 scan, and the
 * callers (the summary route, the morning brief) already fetch it once
 * per tenant and hand it in, so a tenant's reservations are never read
 * twice for the same request.
 *
 * The super-admin "Total Priority Value" KPI needs the same slow-day data
 * across every tenant, and the admin page already fetches exactly that —
 * `fetchSlowDayAggregatesByTenant` (./slow-days-store.ts), one query for
 * the whole platform. It feeds that result into
 * {@link totalTopPriorityValueCents} instead of issuing a second query,
 * so the KPI shares the Gate #2 fetch with the "Slow Days Detected" KPI.
 *
 * Framework-free, like ./classify.ts, ./slow-days.ts and ./cron.ts: no
 * Next, no Drizzle, no `@/lib/db`. Every function that cares about "now"
 * takes it as an option — the mocked-clock tests in ./priorities.test.ts
 * rely on that, and the wiring tests pin it.
 */

import {
  analyzeDayAggregates,
  DAY_NAMES,
  type DayAggregate,
  type SlowDayInsight,
  type SlowDayReport,
} from './slow-days.ts';

/** The average check, in cents (R49). */
export const AVG_CHECK_CENTS = 4900;
/** Chance a missed enquiry still converts when we call back. */
export const MISSED_ENQUIRY_RECOVERY = 0.8;
/** Chance a slow-day campaign fills a table. */
export const SLOW_DAY_CONVERSION = 0.3;
/** Chance a cancelled customer rebooks. */
export const CANCELLATION_REBOOK = 0.5;
/** Chance a no-show customer rebooks. */
export const NO_SHOW_REBOOK = 0.4;
/** How far back (days) missed enquiries, cancellations and no-shows count. */
export const OPPORTUNITY_WINDOW_DAYS = 7;
/** How many actions the owner gets, at most. */
export const MAX_PRIORITIES = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export type OpportunityType = 'missed_enquiry' | 'slow_day' | 'cancellation' | 'no_show';

export type Urgency = 'now' | 'today' | 'this_week';

/** now < today < this_week — the tie-break order. */
const URGENCY_RANK: Record<Urgency, number> = { now: 0, today: 1, this_week: 2 };

/** One ranked action the owner can take today. */
export interface PriorityOpportunity {
  opportunity_type: OpportunityType;
  /** Human-readable action, ready for the dashboard and the morning brief. */
  description: string;
  /** Revenue at stake before the probability adjustment, in cents. */
  estimated_value_cents: number;
  /** Probability-weighted value in cents — what the list is sorted on. */
  priority_score: number;
  urgency: Urgency;
}

/** A missed-enquiry revenue_event row, as read by the tenant scan. */
export interface MissedEnquiryLike {
  tenantId?: string;
  estimatedValueCents: number;
  occurredAt: Date | string;
}

/** A cancelled reservation whose follow-up has not gone out yet. */
export interface PendingCancellationLike {
  tenantId?: string;
  partySize: number;
  cancelledAt: Date | string;
}

/** A detected no-show whose follow-up has not gone out yet. */
export interface PendingNoShowLike {
  tenantId?: string;
  partySize: number;
  /** When the table was for — what the customer missed. */
  reservationDate: Date | string;
  /** When the no-show was detected — what the 7-day window is measured from. */
  detectedAt: Date | string;
}

/**
 * The data the analytics read. The window is `[start, end]` (both
 * inclusive) and `end` is "now": implementers filter it in SQL, and the
 * analytics re-validate every row they return, so a too-wide query can
 * widen the scan but never the blast radius (same pattern as the Gate
 * #2-#4 stores).
 */
export interface PriorityStore {
  findMissedEnquiries(input: { tenantId: string; start: Date; end: Date }): Promise<MissedEnquiryLike[]>;
  findPendingCancellations(input: { tenantId: string; start: Date; end: Date }): Promise<PendingCancellationLike[]>;
  findPendingNoShows(input: { tenantId: string; start: Date; end: Date }): Promise<PendingNoShowLike[]>;
}

/** The raw inputs for one tenant, before scoring and ranking. */
export interface PriorityInputs {
  missedEnquiries?: MissedEnquiryLike[];
  cancellations?: PendingCancellationLike[];
  noShows?: PendingNoShowLike[];
  /** The Gate #2 report; only its critical (<50%) days become opportunities. */
  slowDayReport?: SlowDayReport;
}

export interface PriorityOptions {
  /** Reference "now". Defaults to the current time. */
  now?: Date;
  /** Days in the missed-enquiry / cancellation / no-show window (7). */
  windowDays?: number;
  /** How many actions to return (3). */
  maxPriorities?: number;
  /** Average check in cents (4900). */
  avgCheckCents?: number;
  /** Recovery probability for missed enquiries (0.8). */
  missedEnquiryRecovery?: number;
  /** Conversion probability for slow days (0.3). */
  slowDayConversion?: number;
  /** Rebook probability for cancellations (0.5). */
  cancellationRebook?: number;
  /** Rebook probability for no-shows (0.4). */
  noShowRebook?: number;
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function probability(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;
}

/** Epoch millis for a Date or ISO string, or null when unparseable. */
function timeOf(value: Date | string): number | null {
  const parsed = typeof value === 'string' ? new Date(value) : value;
  const at = parsed.getTime();
  return Number.isFinite(at) ? at : null;
}

/** 'Tue 19 Aug' for a Date or ISO string; 'recently' when unparseable. */
export function formatOpportunityDay(value: Date | string): string {
  const at = timeOf(value);
  if (at === null) return 'recently';
  const parsed = new Date(at);
  return `${DAY_NAMES[parsed.getUTCDay()].slice(0, 3)} ${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]}`;
}

function formatRands(cents: number): string {
  return Math.round(cents / 100).toLocaleString('en-US');
}

/** The missed-enquiry action line, e.g. "Call back the customer ...". */
export function missedEnquiryDescription(occurredAt: Date | string, valueCents: number): string {
  return (
    `Call back the customer who asked about a table on ${formatOpportunityDay(occurredAt)} ` +
    `and was left without a reply (est. R${formatRands(valueCents)})`
  );
}

/** The cancellation action line, e.g. "Offer a rebook to ...". */
export function cancellationDescription(partySize: number, cancelledAt: Date | string): string {
  return `Offer a rebook to the customer who cancelled their table of ${positiveInt(partySize, 1)} on ${formatOpportunityDay(cancelledAt)}`;
}

/** The no-show action line, e.g. "Offer a rebook to ...". */
export function noShowDescription(partySize: number, reservationDate: Date | string): string {
  return `Offer a rebook to the customer who missed their table of ${positiveInt(partySize, 1)} on ${formatOpportunityDay(reservationDate)}`;
}

/** Score for a missed enquiry: its estimated value × 80% recovery. */
export function missedEnquiryScore(estimatedValueCents: number, options: { recovery?: number } = {}): number {
  const value = Math.round(positive(estimatedValueCents, 0));
  return Math.round(value * probability(options.recovery, MISSED_ENQUIRY_RECOVERY));
}

/**
 * The revenue at stake in a critical slow day: a normal day of that
 * weekday, in full. (The 30% conversion probability lives in the score,
 * not in the value — the value is what the day is worth if it recovers.)
 */
export function slowDayEstimatedValueCents(
  insight: Pick<SlowDayInsight, 'historicalAvg' | 'historicalAvgPartySize'>,
  options: { avgCheckCents?: number } = {}
): number {
  return Math.round(
    Math.max(0, insight.historicalAvg) * Math.max(0, insight.historicalAvgPartySize) * positive(options.avgCheckCents, AVG_CHECK_CENTS)
  );
}

/** Score for a critical slow day: historicalAvg × partySize × 4900 × 30%. */
export function slowDayScore(
  insight: Pick<SlowDayInsight, 'historicalAvg' | 'historicalAvgPartySize'>,
  options: { avgCheckCents?: number; conversion?: number } = {}
): number {
  return Math.round(slowDayEstimatedValueCents(insight, options) * probability(options.conversion, SLOW_DAY_CONVERSION));
}

/** The revenue at stake in a cancelled table: partySize × R49. */
export function cancellationValueCents(partySize: number, options: { avgCheckCents?: number } = {}): number {
  return Math.max(1, positiveInt(partySize, 1)) * positive(options.avgCheckCents, AVG_CHECK_CENTS);
}

/** Score for a pending cancellation: partySize × 4900 × 50% rebook. */
export function cancellationScore(partySize: number, options: { avgCheckCents?: number; rebook?: number } = {}): number {
  return Math.round(cancellationValueCents(partySize, options) * probability(options.rebook, CANCELLATION_REBOOK));
}

/** The revenue at stake in a no-show table: partySize × R49. */
export function noShowValueCents(partySize: number, options: { avgCheckCents?: number } = {}): number {
  return Math.max(1, positiveInt(partySize, 1)) * positive(options.avgCheckCents, AVG_CHECK_CENTS);
}

/** Score for a pending no-show: partySize × 4900 × 40% rebook. */
export function noShowScore(partySize: number, options: { avgCheckCents?: number; rebook?: number } = {}): number {
  return Math.round(noShowValueCents(partySize, options) * probability(options.rebook, NO_SHOW_REBOOK));
}

/**
 * The deterministic ordering: score descending, then urgency
 * (now → today → this_week), then type alphabetically. Input order is
 * preserved for exact ties because Array.sort is stable.
 */
export function comparePriorities(a: PriorityOpportunity, b: PriorityOpportunity): number {
  if (a.priority_score !== b.priority_score) return b.priority_score - a.priority_score;
  const urgencyDiff = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  if (urgencyDiff !== 0) return urgencyDiff;
  return a.opportunity_type.localeCompare(b.opportunity_type);
}

/**
 * Score, rank and slice one tenant's opportunities.
 *
 * Pure: given the same inputs and the same `now` it always returns the
 * same list, which is what the mocked-clock tests check. The window is
 * re-validated here even though the store already filters it, so a
 * hand-rolled caller or a too-wide query cannot surface a stale
 * opportunity.
 */
export function buildPriorities(inputs: PriorityInputs, options: PriorityOptions = {}): PriorityOpportunity[] {
  const now = options.now ?? new Date();
  const windowDays = positiveInt(options.windowDays, OPPORTUNITY_WINDOW_DAYS);
  const maxPriorities = positiveInt(options.maxPriorities, MAX_PRIORITIES);
  const windowStart = now.getTime() - windowDays * MS_PER_DAY;
  const nowMs = now.getTime();

  const inWindow = (at: Date | string): boolean => {
    const t = timeOf(at);
    return t !== null && t >= windowStart && t <= nowMs;
  };

  const opportunities: PriorityOpportunity[] = [];

  for (const event of inputs.missedEnquiries ?? []) {
    if (!inWindow(event.occurredAt)) continue;
    const valueCents = Math.round(positive(event.estimatedValueCents, 0));
    if (valueCents <= 0) continue;
    const score = missedEnquiryScore(valueCents, { recovery: options.missedEnquiryRecovery });
    if (score <= 0) continue;
    opportunities.push({
      opportunity_type: 'missed_enquiry',
      description: missedEnquiryDescription(event.occurredAt, valueCents),
      estimated_value_cents: valueCents,
      priority_score: score,
      urgency: 'now',
    });
  }

  for (const day of inputs.slowDayReport?.criticalSlowDays ?? []) {
    if (!day.flags.includes('critical')) continue;
    const valueCents = slowDayEstimatedValueCents(day, { avgCheckCents: options.avgCheckCents });
    const score = slowDayScore(day, { avgCheckCents: options.avgCheckCents, conversion: options.slowDayConversion });
    if (score <= 0) continue;
    opportunities.push({
      opportunity_type: 'slow_day',
      description: day.recommendation,
      estimated_value_cents: valueCents,
      priority_score: score,
      urgency: 'this_week',
    });
  }

  for (const reservation of inputs.cancellations ?? []) {
    if (!inWindow(reservation.cancelledAt)) continue;
    const valueCents = cancellationValueCents(reservation.partySize, { avgCheckCents: options.avgCheckCents });
    const score = cancellationScore(reservation.partySize, {
      avgCheckCents: options.avgCheckCents,
      rebook: options.cancellationRebook,
    });
    opportunities.push({
      opportunity_type: 'cancellation',
      description: cancellationDescription(reservation.partySize, reservation.cancelledAt),
      estimated_value_cents: valueCents,
      priority_score: score,
      urgency: 'today',
    });
  }

  for (const noShow of inputs.noShows ?? []) {
    if (!inWindow(noShow.detectedAt)) continue;
    const valueCents = noShowValueCents(noShow.partySize, { avgCheckCents: options.avgCheckCents });
    const score = noShowScore(noShow.partySize, {
      avgCheckCents: options.avgCheckCents,
      rebook: options.noShowRebook,
    });
    opportunities.push({
      opportunity_type: 'no_show',
      description: noShowDescription(noShow.partySize, noShow.reservationDate),
      estimated_value_cents: valueCents,
      priority_score: score,
      urgency: 'now',
    });
  }

  opportunities.sort(comparePriorities);
  return opportunities.slice(0, maxPriorities);
}

/**
 * Full priority pass for one tenant: run the three tenant-scoped scans,
 * then score and rank against the Gate #2 report the caller already has.
 *
 * This is the single entry point the summary route and the morning brief
 * go through, so the two surfaces can never disagree about what the top
 * 3 actions are.
 */
export async function buildTenantPriorities(
  store: PriorityStore,
  tenantId: string,
  slowDayReport: SlowDayReport,
  options: PriorityOptions = {}
): Promise<PriorityOpportunity[]> {
  const now = options.now ?? new Date();
  const windowDays = positiveInt(options.windowDays, OPPORTUNITY_WINDOW_DAYS);
  const start = new Date(now.getTime() - windowDays * MS_PER_DAY);

  const [missedEnquiries, cancellations, noShows] = await Promise.all([
    store.findMissedEnquiries({ tenantId, start, end: now }),
    store.findPendingCancellations({ tenantId, start, end: now }),
    store.findPendingNoShows({ tenantId, start, end: now }),
  ]);

  return buildPriorities({ missedEnquiries, cancellations, noShows, slowDayReport }, { ...options, now });
}

/**
 * Each tenant's top-priority value (in cents) among its critical slow
 * days, from the per-tenant per-day aggregates the super-admin page
 * already fetched for the "Slow Days Detected" KPI. A tenant with no
 * critical day this week contributes 0.
 *
 * `now` is required in tests — pass it explicitly; see the header on why
 * this module never calls new Date() on its own.
 */
export function topPriorityValueCentsByTenant(
  aggregatesByTenant: Map<string, DayAggregate[]>,
  options: { now?: Date; avgCheckCents?: number } = {}
): Map<string, number> {
  const now = options.now ?? new Date();
  const values = new Map<string, number>();

  aggregatesByTenant.forEach((aggregates, tenantId) => {
    const report = analyzeDayAggregates(aggregates, { now });
    let best = 0;
    for (const day of report.criticalSlowDays) {
      best = Math.max(best, slowDayEstimatedValueCents(day, { avgCheckCents: options.avgCheckCents }));
    }
    values.set(tenantId, best);
  });

  return values;
}

/**
 * The super-admin "Total Priority Value": the sum, across every tenant,
 * of that tenant's highest-value critical-slow-day opportunity.
 *
 * Takes the per-tenant aggregates the admin page already fetched (one
 * shared query for both KPIs) and a `now` — never the clock on its own,
 * so mocked-clock tests are stable at UTC midnight.
 */
export function totalTopPriorityValueCents(
  aggregatesByTenant: Map<string, DayAggregate[]>,
  options: { now?: Date; avgCheckCents?: number } = {}
): number {
  let total = 0;
  topPriorityValueCentsByTenant(aggregatesByTenant, options).forEach((value) => {
    total += value;
  });
  return total;
}
