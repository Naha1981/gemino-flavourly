/**
 * Analytics engine — framework-free aggregation and statistics.
 *
 * Every function here is a pure transform over plain arrays/numbers so it
 * can be unit-tested without a database or any provider SDK. The store layer
 * (lib/analytics/store.ts) pulls raw, tenant-scoped rows from Postgres; this
 * module turns them into the KPIs, deltas, forecasts and cohorts the
 * dashboard renders. Keeping the math here (and the I/O in the store) means
 * the same "what is the 30-day revenue trend?" question has exactly one
 * answer, verified by tests, independent of where the bytes came from.
 */

export type TrendDirection = 'up' | 'down' | 'flat';

export interface KpiDelta {
  current: number;
  previous: number;
  delta: number;
  /** Percentage change vs previous, or null when previous is 0. */
  pctChange: number | null;
  direction: TrendDirection;
}

/** Compare two period totals and describe the movement between them. */
export function comparePeriods(current: number, previous: number): KpiDelta {
  const delta = current - previous;
  const pctChange = previous !== 0 ? (delta / previous) * 100 : null;
  let direction: TrendDirection = 'flat';
  if (delta > 0) direction = 'up';
  else if (delta < 0) direction = 'down';
  return { current, previous, delta, pctChange, direction };
}

/**
 * Trailing moving average. Element `i` is the mean of the up-to-`window`
 * values ending at `i` (so the very first element is just itself). Returns a
 * same-length array; never throws on short input.
 */
export function movingAverage(series: number[], window: number): number[] {
  const w = Math.max(1, Math.floor(window));
  const out: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const start = Math.max(0, i - w + 1);
    const slice = series.slice(start, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    out.push(slice.length ? sum / slice.length : 0);
  }
  return out;
}

/** Most recent trailing moving-average value, or null when series is empty. */
export function lastMovingAverage(series: number[], window: number): number | null {
  if (series.length === 0) return null;
  const ma = movingAverage(series, window);
  return ma[ma.length - 1];
}

export interface LinearFit {
  slope: number;
  intercept: number;
  r2: number;
}

/** Ordinary least-squares fit of y = slope*x + intercept. */
export function linearRegression(xs: number[], ys: number[]): LinearFit {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) {
    const meanY = n === 1 ? ys[0] : 0;
    return { slope: 0, intercept: meanY, r2: 0 };
  }
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  const meanY = sy / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssTot += (ys[i] - meanY) ** 2;
    ssRes += (ys[i] - pred) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

export interface RevenueForecast {
  slope: number;
  intercept: number;
  r2: number;
  /** Projected total revenue (cents) across the next `horizonDays`. */
  forecastCents: number;
  dailyPoints: { day: number; cents: number }[];
  trend: TrendDirection;
}

/**
 * Linear-regression 30-day revenue forecast.
 *
 * Fits a line to the supplied daily-cent series (x = day index) and projects
 * `horizonDays` beyond the last observed day. Clamps each projected day at 0
 * (revenue cannot go negative) and reports the trend from the slope. With
 * fewer than two points the forecast is flat at the last known value.
 */
export function forecastRevenue(dailyCents: number[], horizonDays = 30): RevenueForecast {
  const horizon = Math.max(1, Math.floor(horizonDays));
  if (dailyCents.length < 2) {
    const last = dailyCents.length === 1 ? dailyCents[0] : 0;
    const dailyPoints = Array.from({ length: horizon }, (_, i) => ({ day: dailyCents.length + i, cents: last }));
    return { slope: 0, intercept: last, r2: 0, forecastCents: last * horizon, dailyPoints, trend: 'flat' };
  }

  const xs = dailyCents.map((_, i) => i);
  const fit = linearRegression(xs, dailyCents);
  const dailyPoints: { day: number; cents: number }[] = [];
  let forecastCents = 0;
  for (let i = 0; i < horizon; i++) {
    const day = dailyCents.length + i;
    const raw = fit.slope * day + fit.intercept;
    const cents = Math.max(0, Math.round(raw));
    dailyPoints.push({ day, cents });
    forecastCents += cents;
  }
  const trend: TrendDirection = fit.slope > 0 ? 'up' : fit.slope < 0 ? 'down' : 'flat';
  return { slope: fit.slope, intercept: fit.intercept, r2: fit.r2, forecastCents, dailyPoints, trend };
}

export interface CohortRow {
  cohortMonth: string;
  cohortSize: number;
  /** retention[0] is always 100 (the signup month); retention[k] is the % of the cohort active in month k. */
  retention: number[];
}

function parseMonth(s: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]) };
}

function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}`;
}

function addMonths(y: number, m: number, k: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + k;
  return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 + 1 };
}

export interface CohortInput {
  firstMonth: string;
  customerId: string;
  activeMonth: string;
}

/**
 * Cohort retention grouped by first-visit month.
 *
 * Each cohort is the set of customers whose first visit fell in a given
 * month; `retention[k]` is the share of that cohort seen again in month k
 * (0-indexed from the cohort month). Input is just three strings per
 * observation, so the store can feed it straight from a GROUP BY.
 */
export function cohortRetention(rows: CohortInput[]): CohortRow[] {
  const byMonth = new Map<string, Set<string>>();
  const activeByCustomer = new Map<string, Set<string>>();

  for (const r of rows) {
    if (!parseMonth(r.firstMonth) || !parseMonth(r.activeMonth)) continue;
    if (!byMonth.has(r.firstMonth)) byMonth.set(r.firstMonth, new Set());
    byMonth.get(r.firstMonth)!.add(r.customerId);
    if (!activeByCustomer.has(r.customerId)) activeByCustomer.set(r.customerId, new Set());
    activeByCustomer.get(r.customerId)!.add(r.activeMonth);
  }

  const result: CohortRow[] = [];
  for (const [cohortMonth, customers] of Array.from(byMonth.entries()).sort()) {
    const size = customers.size;
    const first = parseMonth(cohortMonth)!;

    let maxOffset = 0;
    const customerArr = Array.from(customers);
    for (const c of customerArr) {
      const set = activeByCustomer.get(c);
      if (!set) continue;
      const activeMonths = Array.from(set);
      for (const am of activeMonths) {
        const p = parseMonth(am)!;
        const offset = (p.y - first.y) * 12 + (p.m - first.m);
        if (offset > maxOffset) maxOffset = offset;
      }
    }

    const retention: number[] = [];
    for (let k = 0; k <= maxOffset; k++) {
      const target = addMonths(first.y, first.m, k);
      const targetKey = monthKey(target.y, target.m);
      let retained = 0;
      for (const c of customerArr) {
        if (activeByCustomer.get(c)?.has(targetKey)) retained++;
      }
      retention.push(size === 0 ? 0 : Math.round((retained / size) * 1000) / 10);
    }
    result.push({ cohortMonth, cohortSize: size, retention });
  }
  return result;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface EngineSummary {
  engine: string;
  total30: number;
  ma7: number | null;
  ma30: number | null;
  mom: KpiDelta;
  wow: KpiDelta;
  trend: TrendDirection;
}

/**
 * Reduce a daily time-series into the KPIs the dashboard shows for one
 * engine: 30-day total with MoM/WoW deltas and 7/30-day moving averages.
 * Buckets are aligned to calendar days relative to `now`, so the same raw
 * series always yields the same summary.
 */
export function summarizeDailySeries(engine: string, points: DailyPoint[], now: Date = new Date()): EngineSummary {
  const dayMs = 24 * 60 * 60 * 1000;
  const todayKey = now.toISOString().slice(0, 10);
  const index = new Map<string, number>();
  for (const p of points) index.set(p.date.slice(0, 10), (index.get(p.date.slice(0, 10)) ?? 0) + p.value);

  const sumWindow = (endKey: string, days: number): number => {
    let sum = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(new Date(endKey).getTime() - i * dayMs);
      const key = d.toISOString().slice(0, 10);
      sum += index.get(key) ?? 0;
    }
    return sum;
  };

  const last30 = sumWindow(todayKey, 30);
  const prev30 = sumWindow(new Date(new Date(todayKey).getTime() - 30 * dayMs).toISOString().slice(0, 10), 30);
  const last7 = sumWindow(todayKey, 7);
  const prev7 = sumWindow(new Date(new Date(todayKey).getTime() - 7 * dayMs).toISOString().slice(0, 10), 7);

  // Recent daily values in chronological order for the moving averages.
  const recentKeys: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(new Date(todayKey).getTime() - i * dayMs);
    recentKeys.push(d.toISOString().slice(0, 10));
  }
  const recent = recentKeys.map((k) => index.get(k) ?? 0);

  const mom = comparePeriods(last30, prev30);
  const wow = comparePeriods(last7, prev7);
  const trend: TrendDirection = mom.direction !== 'flat' ? mom.direction : wow.direction;

  return {
    engine,
    total30: last30,
    ma7: lastMovingAverage(recent, 7),
    ma30: lastMovingAverage(recent, 30),
    mom,
    wow,
    trend,
  };
}

export interface PlatformOverview {
  engines: EngineSummary[];
  generatedAt: string;
}

export function buildOverview(summaries: EngineSummary[]): PlatformOverview {
  return { engines: summaries, generatedAt: new Date().toISOString() };
}
