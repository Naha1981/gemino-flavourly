/**
 * Gate #6 — Revenue Opportunity Calculation (Revenue Intelligence Engine).
 *
 * Gates #1-#4 each found a kind of revenue opportunity and Gate #5 ranked
 * them into the three most worthwhile actions. This gate answers the
 * bottom-line question: across every opportunity in the last 30 days,
 * how much potential revenue is on the table, how likely is it to be
 * recovered, and what is that worth in expectation?
 *
 * ── The four components ────────────────────────────────────────────────
 *
 *   missed_enquiry_value — the estimated value (cents) of every
 *   `revenue_events` row of type 'missed_enquiry' inside the window,
 *   measured on `occurred_at`. The raw value is used here; the recovery
 *   probability (0.8) lives in `recovery_probability`.
 *
 *   slow_day_value — for every critical slow day in the Gate #2 report
 *   the caller already has, `slowDayScore` (historicalAvg ×
 *   historicalAvgPartySize × 4900 × 0.3). The report is an input, never
 *   a second reservation read, so a tenant's history is scanned once.
 *
 *   cancellation_value — for every cancelled reservation inside the
 *   window, `cancellationScore` (partySize × 4900 × 0.5), measured on
 *   `cancelled_at`. Unlike Gate #3/#5 this counts every cancellation,
 *   followed up or not: the table revenue was lost either way and is
 *   still potential recovery.
 *
 *   no_show_value — for every no-show inside the window,
 *   `noShowScore` (partySize × 4900 × 0.4), measured on
 *   `no_show_detected_at`. Same rule as cancellations: a no-show that
 *   already received a rebook offer still left a table empty.
 *
 * ── The three summary numbers ──────────────────────────────────────────
 *
 *   total_opportunity_cents — the sum of the four components.
 *
 *   recovery_probability — the value-weighted average of each
 *   component's recovery probability (missed 0.8, slow 0.3, cancellation
 *   0.5, no-show 0.4). A tenant whose value is mostly in missed
 *   enquiries therefore has a higher expected recovery rate than one
 *   whose value is mostly slow days.
 *
 *   expected_recovery_cents — total_opportunity_cents ×
 *   recovery_probability. Equivalently the sum of each component × its
 *   own probability, which is why it is stable at any scale.
 *
 * ── The store boundary ─────────────────────────────────────────────────
 *
 * The {@link OpportunityStore} interface is defined HERE, not in the
 * Drizzle adapter, so the tests can fake it without importing @/lib/db
 * (which throws at import time without DATABASE_URL). The adapter
 * (./opportunity-store.ts) implements the three tenant-scoped scans:
 * missed enquiries, cancellations and no-shows. The fourth input — the
 * slow-day report — is the Gate #2 scan, and the callers (the summary
 * route, the morning brief) already fetch it once per tenant and hand it
 * in, so a tenant's reservations are never read twice for the same
 * request.
 *
 * The super-admin "Platform Total Opportunity" KPI needs the same inputs
 * across every tenant. The adapter's `fetchCrossTenantOpportunityInputs`
 * reads the missed-enquiry, cancellation and no-show rows for the whole
 * platform in three bounded queries, and the admin page already has the
 * Gate #2 per-tenant aggregates for the "Slow Days Detected" KPI. It
 * feeds both into {@link calculatePlatformOpportunity} (one shared
 * summarize pass per tenant) so the platform total is exactly the sum of
 * each tenant's own total.
 *
 * Framework-free, like ./classify.ts, ./slow-days.ts, ./cron.ts and
 * ./priorities.ts: no Next, no Drizzle, no `@/lib/db`. Every function
 * that cares about "now" takes it as an option — the mocked-clock tests
 * in ./opportunity.test.ts rely on that, and the wiring tests pin it.
 */

import {
  MISSED_ENQUIRY_RECOVERY,
  SLOW_DAY_CONVERSION,
  CANCELLATION_REBOOK,
  NO_SHOW_REBOOK,
  cancellationScore,
  noShowScore,
  slowDayScore,
  type MissedEnquiryLike as PriorityMissedEnquiryLike,
} from './priorities.ts';
import { analyzeDayAggregates, type DayAggregate, type SlowDayReport } from './slow-days.ts';

/** How far back (days) the four opportunity scans count. */
export const OPPORTUNITY_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A valued missed-enquiry revenue_event, as read by the tenant scan. */
export interface MissedEnquiryLike extends PriorityMissedEnquiryLike {
  estimatedValueCents: number;
  occurredAt: Date | string;
}

/**
 * A cancelled reservation, windowed on `cancelled_at`. Unlike Gate
 * #3/#5 there is no "follow-up still pending" predicate: the revenue was
 * lost whether or not the rebook offer has gone out.
 */
export interface CancellationLike {
  tenantId?: string;
  partySize: number;
  cancelledAt: Date | string;
}

/**
 * A detected no-show, windowed on `no_show_detected_at`. Same rule as
 * cancellations: follow-up state does not change that a table was empty.
 */
export interface NoShowLike {
  tenantId?: string;
  partySize: number;
  detectedAt: Date | string;
}

/**
 * The data the analytics read. The window is `[start, end]` (both
 * inclusive) and `end` is "now": implementers filter it in SQL, and the
 * analytics re-validate every row they return, so a too-wide query can
 * widen the scan but never the blast radius (same pattern as the Gate
 * #2-#5 stores).
 */
export interface OpportunityStore {
  findMissedEnquiries(input: { tenantId: string; start: Date; end: Date }): Promise<MissedEnquiryLike[]>;
  findCancellations(input: { tenantId: string; start: Date; end: Date }): Promise<CancellationLike[]>;
  findNoShows(input: { tenantId: string; start: Date; end: Date }): Promise<NoShowLike[]>;
}

/** The raw inputs for one tenant, before scoring and summing. */
export interface OpportunityInputs {
  missedEnquiries?: MissedEnquiryLike[];
  cancellations?: CancellationLike[];
  noShows?: NoShowLike[];
  /**
   * The Gate #2 report. `criticalSlowDays` (under 50%) becomes the
   * slow-day component — the same tier Gate #5 treats as an action, so
   * the dashboard, the brief and the priorities never disagree about
   * what a slow-day opportunity is.
   */
  slowDayReport?: SlowDayReport;
}

/** The summary returned to the API, the brief and the super-admin KPI. */
export interface OpportunitySummary {
  missed_enquiry_value: number;
  slow_day_value: number;
  cancellation_value: number;
  no_show_value: number;
  total_opportunity_cents: number;
  recovery_probability: number;
  expected_recovery_cents: number;
}

export interface OpportunityOptions {
  /** Reference "now". Defaults to the current time. */
  now?: Date;
  /** Days in the missed-enquiry / cancellation / no-show window (30). */
  windowDays?: number;
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

/** true when `at` is inside `[startMs, endMs]` (both inclusive). */
function inWindow(at: Date | string, startMs: number, endMs: number): boolean {
  const t = timeOf(at);
  return t !== null && t >= startMs && t <= endMs;
}

/**
 * The shared summarize math: given the four already-scored component
 * values (in cents), derive the total, the value-weighted recovery
 * probability and the expected recovery.
 *
 * Exported so the super-admin path can sum the same components across
 * every tenant and run exactly the same math, which is what makes the
 * platform total the sum of each tenant's own total.
 */
export function summarizeOpportunityValues(
  values: {
    missed_enquiry_value: number;
    slow_day_value: number;
    cancellation_value: number;
    no_show_value: number;
  },
  options: OpportunityOptions = {}
): OpportunitySummary {
  const missed = Math.max(0, Math.round(values.missed_enquiry_value));
  const slow = Math.max(0, Math.round(values.slow_day_value));
  const cancellation = Math.max(0, Math.round(values.cancellation_value));
  const noShow = Math.max(0, Math.round(values.no_show_value));

  const missedProb = probability(options.missedEnquiryRecovery, MISSED_ENQUIRY_RECOVERY);
  const slowProb = probability(options.slowDayConversion, SLOW_DAY_CONVERSION);
  const cancellationProb = probability(options.cancellationRebook, CANCELLATION_REBOOK);
  const noShowProb = probability(options.noShowRebook, NO_SHOW_REBOOK);

  const total = missed + slow + cancellation + noShow;
  const weightedNumerator = missed * missedProb + slow * slowProb + cancellation * cancellationProb + noShow * noShowProb;

  const recoveryProbability = total === 0 ? 0 : Math.round((weightedNumerator / total) * 10000) / 10000;
  const expectedRecoveryCents = total === 0 ? 0 : Math.round(weightedNumerator);

  return {
    missed_enquiry_value: missed,
    slow_day_value: slow,
    cancellation_value: cancellation,
    no_show_value: noShow,
    total_opportunity_cents: total,
    recovery_probability: recoveryProbability,
    expected_recovery_cents: expectedRecoveryCents,
  };
}

/**
 * Score and sum one tenant's opportunities.
 *
 * Pure: given the same inputs and the same `now` it always returns the
 * same summary. The window is re-validated here even though the store
 * already filters it, so a hand-rolled caller or a too-wide query cannot
 * surface a stale opportunity.
 */
export function summarizeOpportunity(inputs: OpportunityInputs, options: OpportunityOptions = {}): OpportunitySummary {
  const now = options.now ?? new Date();
  const windowDays = positiveInt(options.windowDays, OPPORTUNITY_WINDOW_DAYS);
  const startMs = now.getTime() - windowDays * MS_PER_DAY;
  const endMs = now.getTime();

  let missed = 0;
  for (const event of inputs.missedEnquiries ?? []) {
    if (!inWindow(event.occurredAt, startMs, endMs)) continue;
    const value = Math.round(positive(event.estimatedValueCents, 0));
    if (value > 0) missed += value;
  }

  let slow = 0;
  for (const day of inputs.slowDayReport?.criticalSlowDays ?? []) {
    if (!day.flags.includes('critical')) continue;
    slow += slowDayScore(day, { avgCheckCents: options.avgCheckCents, conversion: options.slowDayConversion });
  }

  let cancellation = 0;
  for (const reservation of inputs.cancellations ?? []) {
    if (!inWindow(reservation.cancelledAt, startMs, endMs)) continue;
    cancellation += cancellationScore(reservation.partySize, {
      avgCheckCents: options.avgCheckCents,
      rebook: options.cancellationRebook,
    });
  }

  let noShow = 0;
  for (const reservation of inputs.noShows ?? []) {
    if (!inWindow(reservation.detectedAt, startMs, endMs)) continue;
    noShow += noShowScore(reservation.partySize, {
      avgCheckCents: options.avgCheckCents,
      rebook: options.noShowRebook,
    });
  }

  return summarizeOpportunityValues(
    {
      missed_enquiry_value: missed,
      slow_day_value: slow,
      cancellation_value: cancellation,
      no_show_value: noShow,
    },
    options
  );
}

/**
 * Full opportunity pass for one tenant: run the three tenant-scoped
 * scans, then summarize against the Gate #2 report the caller already
 * has.
 *
 * This is the single entry point the summary route and the morning brief
 * go through, so the two surfaces can never disagree about what the
 * total potential revenue is.
 */
export async function buildTenantOpportunity(
  store: OpportunityStore,
  tenantId: string,
  slowDayReport: SlowDayReport,
  options: OpportunityOptions = {}
): Promise<OpportunitySummary> {
  const now = options.now ?? new Date();
  const windowDays = positiveInt(options.windowDays, OPPORTUNITY_WINDOW_DAYS);
  const start = new Date(now.getTime() - windowDays * MS_PER_DAY);

  const [missedEnquiries, cancellations, noShows] = await Promise.all([
    store.findMissedEnquiries({ tenantId, start, end: now }),
    store.findCancellations({ tenantId, start, end: now }),
    store.findNoShows({ tenantId, start, end: now }),
  ]);

  return summarizeOpportunity({ missedEnquiries, cancellations, noShows, slowDayReport }, { ...options, now });
}

export interface PlatformOpportunityOptions extends OpportunityOptions {
  /** Gate #2 per-tenant aggregates (already fetched for the slow-day KPI). */
  slowDayAggregatesByTenant?: Map<string, DayAggregate[]>;
  /** Gate #2 per-tenant reports, if the caller already derived them. */
  slowDayReportsByTenant?: Map<string, SlowDayReport>;
}

/**
 * The super-admin "Platform Total Opportunity": the sum, across every
 * tenant, of that tenant's own total opportunity value.
 *
 * Takes the per-tenant missed/cancellation/no-show inputs from
 * `fetchCrossTenantOpportunityInputs` and the Gate #2 per-tenant
 * aggregates the admin page already fetched (one shared query for both
 * the slow-day and opportunity KPIs), then runs the exact same
 * {@link summarizeOpportunity} per tenant. Because each tenant's total
 * is the sum of its own four components, the platform total is the sum
 * of every tenant's own total — the invariant the wiring tests pin.
 */
export function calculatePlatformOpportunity(
  inputsByTenant: Map<string, OpportunityInputs>,
  options: PlatformOpportunityOptions = {}
): OpportunitySummary {
  const now = options.now ?? new Date();
  let missed = 0;
  let slow = 0;
  let cancellation = 0;
  let noShow = 0;

  inputsByTenant.forEach((inputs, tenantId) => {
    const slowDayReport =
      inputs.slowDayReport ??
      options.slowDayReportsByTenant?.get(tenantId) ??
      (options.slowDayAggregatesByTenant
        ? analyzeDayAggregates(options.slowDayAggregatesByTenant.get(tenantId) ?? [], { now })
        : undefined);

    const summary = summarizeOpportunity({ ...inputs, slowDayReport }, { ...options, now });
    missed += summary.missed_enquiry_value;
    slow += summary.slow_day_value;
    cancellation += summary.cancellation_value;
    noShow += summary.no_show_value;
  });

  return summarizeOpportunityValues(
    {
      missed_enquiry_value: missed,
      slow_day_value: slow,
      cancellation_value: cancellation,
      no_show_value: noShow,
    },
    { ...options, now }
  );
}
