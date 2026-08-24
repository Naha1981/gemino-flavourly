/**
 * Gate #8 — Customer Segmentation.
 *
 * This module contains only the segmentation math. It deliberately has no
 * Next.js, Drizzle, or database imports so the rules can be exercised by
 * unit tests and reused by the cron boundary without coupling the decision
 * to a particular runtime.
 */

export const CUSTOMER_SEGMENTS = ['vip', 'regular', 'at_risk', 'dormant', 'new'] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

/** The recency horizon used to turn days since a visit into a 0..1 score. */
export const RECENCY_HORIZON_DAYS = 180;
export const VIP_VISIT_THRESHOLD = 10;
export const VIP_SPEND_THRESHOLD_CENTS = 200_000;
export const VIP_RECENCY_DAYS = 60;
export const REGULAR_VISIT_THRESHOLD = 4;
export const REGULAR_SPEND_THRESHOLD_CENTS = 50_000;
export const REGULAR_RECENCY_DAYS = 120;
export const AT_RISK_MIN_DAYS = 120;
export const AT_RISK_MAX_DAYS = 180;
export const NEW_MAX_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type DateLike = Date | string | number | null | undefined;
type NumberLike = number | string | null | undefined;

/**
 * The camelCase names are the Drizzle shape. Snake-case aliases are accepted
 * as well because this function is also useful at API boundaries and in
 * scripts that read raw Postgres rows.
 */
export interface CustomerProfileForSegmentation {
  totalVisits?: NumberLike;
  total_visits?: NumberLike;
  totalSpendCents?: NumberLike;
  total_spend_cents?: NumberLike;
  lastVisitAt?: DateLike;
  last_visit_at?: DateLike;
  last_visit?: DateLike;
  /** Short aliases make the framework-free function convenient for callers. */
  lastVisit?: DateLike;
  firstVisitAt?: DateLike;
  first_visit_at?: DateLike;
  first_visit?: DateLike;
  firstVisit?: DateLike;
}

export interface SegmentationOptions {
  /** Injected clock, primarily for deterministic tests. */
  now?: Date;
}

export interface SegmentationResult {
  segment: CustomerSegment;
  confidence: number;
}

function valueOf(profile: CustomerProfileForSegmentation, ...keys: string[]): unknown {
  const row = profile as Record<string, unknown>;
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
}

function asNonNegativeNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nowFrom(options: SegmentationOptions | Date = {}): Date {
  const now = options instanceof Date ? options : options.now;
  return now && !Number.isNaN(now.getTime()) ? now : new Date();
}

/**
 * Fractional elapsed days since a timestamp. Missing or invalid timestamps
 * return null rather than pretending that an unknown visit is recent.
 * Future timestamps are clamped to zero: a clock skew cannot make a profile
 * less confident than a visit made today.
 */
export function daysSince(value: DateLike, now: Date = new Date()): number | null {
  const date = asDate(value);
  if (!date) return null;
  return Math.max(0, (now.getTime() - date.getTime()) / MS_PER_DAY);
}

/**
 * Convert recency into the score used by the VIP and Regular confidence
 * formulas. Today is 1, the 180-day lifecycle boundary is 0, and older or
 * unknown visits contribute no recency confidence.
 */
export function recencyScore(daysSinceVisit: number | null, horizonDays = RECENCY_HORIZON_DAYS): number {
  if (daysSinceVisit === null || !Number.isFinite(daysSinceVisit) || horizonDays <= 0) return 0;
  return clamp01(1 - Math.max(0, daysSinceVisit) / horizonDays);
}

export const calculateRecencyScore = recencyScore;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function profileValues(profile: CustomerProfileForSegmentation, now: Date) {
  const totalVisits = asNonNegativeNumber(valueOf(profile, 'totalVisits', 'total_visits'));
  const totalSpendCents = asNonNegativeNumber(valueOf(profile, 'totalSpendCents', 'total_spend_cents'));
  const lastVisitAt = valueOf(profile, 'lastVisitAt', 'last_visit_at', 'last_visit', 'lastVisit') as DateLike;
  const firstVisitAt = valueOf(profile, 'firstVisitAt', 'first_visit_at', 'first_visit', 'firstVisit') as DateLike;

  return {
    totalVisits,
    totalSpendCents,
    daysSinceVisit: daysSince(lastVisitAt, now),
    daysSinceFirst: daysSince(firstVisitAt, now),
  };
}

function isWithin(days: number | null, maxDays: number): boolean {
  return days !== null && days >= 0 && days <= maxDays;
}

function isAtRisk(days: number | null): boolean {
  return days !== null && days > AT_RISK_MIN_DAYS && days < AT_RISK_MAX_DAYS;
}

function isNew(values: ReturnType<typeof profileValues>): boolean {
  return values.totalVisits === 1 && values.daysSinceFirst !== null && values.daysSinceFirst < NEW_MAX_DAYS;
}

/**
 * Confidence for a selected segment. The ratios are intentionally not
 * rounded: callers can display a rounded value while API consumers retain
 * the exact score produced by the rule.
 */
export function confidenceForSegment(
  segment: CustomerSegment,
  profile: CustomerProfileForSegmentation,
  options: SegmentationOptions | Date = {}
): number {
  const now = nowFrom(options);
  const values = profileValues(profile, now);
  const recency = recencyScore(values.daysSinceVisit);

  switch (segment) {
    case 'vip':
      return clamp01(
        (values.totalVisits / VIP_VISIT_THRESHOLD +
          values.totalSpendCents / VIP_SPEND_THRESHOLD_CENTS +
          recency) /
          3
      );
    case 'regular':
      return clamp01(
        (values.totalVisits / REGULAR_VISIT_THRESHOLD +
          values.totalSpendCents / REGULAR_SPEND_THRESHOLD_CENTS +
          recency) /
          3
      );
    case 'at_risk':
      return isAtRisk(values.daysSinceVisit) ? 1 : 0.5;
    case 'dormant':
      return values.totalVisits === 0 || (values.daysSinceVisit !== null && values.daysSinceVisit > AT_RISK_MAX_DAYS)
        ? 1
        : 0;
    case 'new':
      return isNew(values) ? 1 : 0;
  }
}

/**
 * Classify one customer using the rules in priority order. VIP and Regular
 * deliberately run before the stale segments; a high-value customer who is
 * still visiting regularly must never be downgraded merely because another
 * rule also describes an older profile shape.
 *
 * Profiles that fall between the explicitly specified windows are retained
 * as `new` with zero confidence. This keeps the return type exhaustive while
 * avoiding an invented sixth segment; the next cron run will re-evaluate it.
 */
export function calculateCustomerSegment(
  profile: CustomerProfileForSegmentation,
  options: SegmentationOptions | Date = {}
): SegmentationResult {
  const now = nowFrom(options);
  const values = profileValues(profile, now);

  const vip =
    values.totalVisits >= VIP_VISIT_THRESHOLD &&
    values.totalSpendCents >= VIP_SPEND_THRESHOLD_CENTS &&
    isWithin(values.daysSinceVisit, VIP_RECENCY_DAYS);
  if (vip) {
    return { segment: 'vip', confidence: confidenceForSegment('vip', profile, now) };
  }

  const regular =
    values.totalVisits >= REGULAR_VISIT_THRESHOLD &&
    values.totalSpendCents >= REGULAR_SPEND_THRESHOLD_CENTS &&
    isWithin(values.daysSinceVisit, REGULAR_RECENCY_DAYS);
  if (regular) {
    return { segment: 'regular', confidence: confidenceForSegment('regular', profile, now) };
  }

  if (
    values.totalVisits >= 2 &&
    isAtRisk(values.daysSinceVisit)
  ) {
    return { segment: 'at_risk', confidence: confidenceForSegment('at_risk', profile, now) };
  }

  if (
    values.totalVisits === 0 ||
    values.daysSinceVisit === null ||
    values.daysSinceVisit > AT_RISK_MAX_DAYS
  ) {
    return { segment: 'dormant', confidence: confidenceForSegment('dormant', profile, now) };
  }

  if (isNew(values)) {
    return { segment: 'new', confidence: confidenceForSegment('new', profile, now) };
  }

  return { segment: 'new', confidence: 0 };
}

// Descriptive aliases keep the rule easy to discover for callers without
// introducing separate implementations that could drift apart.
export const calculateSegment = calculateCustomerSegment;
export const segmentCustomer = calculateCustomerSegment;
export const classifyCustomer = calculateCustomerSegment;
export const determineSegment = calculateCustomerSegment;

export function isCustomerSegment(value: string | null | undefined): value is CustomerSegment {
  return !!value && (CUSTOMER_SEGMENTS as readonly string[]).includes(value);
}

export function normalizeCustomerSegment(value: string | null | undefined): CustomerSegment | undefined {
  if (isCustomerSegment(value)) return value;
  if (value === 'at-risk') return 'at_risk';
  return undefined;
}
