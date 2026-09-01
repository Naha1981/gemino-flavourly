/**
 * GATE PM-1 — segment aggregation + the PII guard.
 *
 * Framework-free. `summarizeSegments` turns raw profile rows into
 * anonymized per-segment averages; `detectPII` is the belt-and-braces
 * check the engine runs on the exact JSON about to be sent to an LLM —
 * if anything that looks like a phone number, email, or @handle slipped
 * in, the simulation refuses to run rather than leaking it.
 */
import {
  PULSEMAP_SEGMENTS,
  isPulseMapSegment,
  type PulseMapSegment,
  type SegmentSummary,
} from './types.ts';

/**
 * Input shape: ONLY the aggregate-relevant columns. A caller physically
 * cannot pass a name or phone through this interface — the type is the
 * first PII guard.
 */
export interface ProfileRowForAggregation {
  segment: string | null;
  totalVisits?: number | string | null;
  totalSpendCents?: number | string | null;
  lastVisitAt?: Date | string | null;
}

function toNumber(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function daysSince(date: Date | string | null | undefined, now: Date): number | null {
  if (!date) return null;
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / 86_400_000));
}

/**
 * Aggregate profile rows into per-segment summaries. Every known segment
 * is present (zeros when empty) so downstream consumers never guess.
 */
export function summarizeSegments(
  rows: ProfileRowForAggregation[],
  now: Date = new Date(),
): SegmentSummary[] {
  const buckets = new Map<PulseMapSegment, { count: number; visits: number; spend: number; days: number; daysCount: number }>();
  for (const segment of PULSEMAP_SEGMENTS) {
    buckets.set(segment, { count: 0, visits: 0, spend: 0, days: 0, daysCount: 0 });
  }
  for (const row of rows) {
    if (!isPulseMapSegment(row.segment)) continue;
    const b = buckets.get(row.segment)!;
    b.count += 1;
    b.visits += toNumber(row.totalVisits);
    b.spend += toNumber(row.totalSpendCents);
    const d = daysSince(row.lastVisitAt, now);
    if (d !== null) {
      b.days += d;
      b.daysCount += 1;
    }
  }
  return PULSEMAP_SEGMENTS.map((segment) => {
    const b = buckets.get(segment)!;
    return {
      segment,
      count: b.count,
      avgVisits: b.count > 0 ? Math.round((b.visits / b.count) * 10) / 10 : 0,
      avgSpendCents: b.count > 0 ? Math.round(b.spend / b.count) : 0,
      avgDaysSinceLastVisit: b.daysCount > 0 ? Math.round(b.days / b.daysCount) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// PII detector — runs on the serialized prompt context right before an
// external LLM call. Structural typing already keeps PII out; this is the
// runtime tripwire (and the unit-tested guarantee the gate requires).
// ---------------------------------------------------------------------------

/** SA-centric phone patterns + emails + @handles. */
const PHONE_PATTERNS: RegExp[] = [
  /\+27\d{8,10}/, // +27...
  /(?<![\d/.])0\d{8,9}(?![\d/.])/, // 0821234567 (not inside a decimal/version)
  /(?<!\d)(?:82|83|84|72|73|79)\d{7}(?!\d)/, // bare mobile body
];
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.]+/;

export interface PIIDetection {
  hasPII: boolean;
  matches: string[];
}

/** Scan serialized content for phone numbers, emails, and handles. */
export function detectPII(content: string): PIIDetection {
  const matches: string[] = [];
  // Normalize digit separators (082 555 1234 / 082-555-1234 / 082.555.1234)
  // so spaced phone numbers cannot slip past the digit-run patterns.
  const normalized = content.replace(/(?<=\d)[\s.\-](?=\d)/g, '');
  for (const pattern of PHONE_PATTERNS) {
    for (const m of Array.from(normalized.matchAll(new RegExp(pattern.source, 'g')))) {
      matches.push(m[0]);
    }
  }
  for (const m of Array.from(content.matchAll(new RegExp(EMAIL_PATTERN.source, 'g')))) {
    // 'deadbeef@…' style fixture emails still count — the guard is absolute.
    matches.push(m[0]);
  }
  return { hasPII: matches.length > 0, matches };
}

/** Serialize the AI-facing context and verify it is PII-free. */
export function assertContextIsPIIFree(context: unknown): void {
  const serialized = JSON.stringify(context);
  const detection = detectPII(serialized);
  if (detection.hasPII) {
    throw new Error(
      `PulseMap PII guard tripped: refusing to simulate because the AI context contains ${detection.matches.length} possible identifier(s). Nothing was sent.`,
    );
  }
}
