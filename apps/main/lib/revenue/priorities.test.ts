import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVG_CHECK_CENTS,
  MAX_PRIORITIES,
  buildPriorities,
  buildTenantPriorities,
  cancellationDescription,
  cancellationScore,
  cancellationValueCents,
  comparePriorities,
  missedEnquiryDescription,
  missedEnquiryScore,
  noShowDescription,
  noShowScore,
  noShowValueCents,
  slowDayEstimatedValueCents,
  slowDayScore,
  topPriorityValueCentsByTenant,
  totalTopPriorityValueCents,
  type MissedEnquiryLike,
  type OpportunityType,
  type PriorityOpportunity,
  type PriorityStore,
  type Urgency,
} from './priorities.ts';
import {
  HISTORY_DAYS,
  WEEK_DAYS,
  analyzeSlowDays,
  computeSlowDayWindow,
  detectSlowDaysForTenant,
  toDayKey,
  type DayAggregate,
  type ReservationLike,
  type SlowDayReport,
  type SlowDayStore,
} from './slow-days.ts';

/**
 * Gate #5 tests.
 *
 * priorities.ts is framework-free, so the unit tests exercise the real
 * scoring, ranking and slicing directly; the "E2E" section runs the exact
 * path the /api/revenue/summary route runs (detectSlowDaysForTenant, then
 * buildTenantPriorities through a fake store seeded with raw table rows)
 * and pins the full ranking. The tenant-isolation section proves one
 * restaurant's opportunities can never leak into another's, and the
 * mocked-clock section proves the super-admin total is stable when the
 * clock is pinned to UTC midnight.
 */

/** A Monday at 07:00 UTC — the same moment the daily brief cron runs. */
const NOW = new Date('2026-08-24T07:00:00.000Z');
/** UTC midnight the same day — the mocked-clock reference. */
const MIDNIGHT = new Date('2026-08-24T00:00:00.000Z');
const MS_DAY = 24 * 60 * 60 * 1000;
const TENANT = 'tenant-bistro';
const RIVAL = 'tenant-rival';

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_DAY);
}

/** A reservation row with the Gate #3/#4 bookkeeping flags for seeding. */
interface SeededReservation extends ReservationLike {
  cancelledAt?: Date;
  cancellationFollowupSent?: boolean;
  noShowDetected?: boolean;
  noShowDetectedAt?: Date;
  noShowFollowupSent?: boolean;
}

/**
 * An in-memory stand-in for the three tenant scans. Like the Drizzle
 * adapter it filters by tenant AND window, so a wrong window or a missing
 * tenant scope shows up as missing data instead of silently passing.
 */
function fakePriorityStore(
  missed: MissedEnquiryLike[],
  reservations: SeededReservation[]
): { store: PriorityStore; calls: Array<{ method: string; tenantId: string; start: Date; end: Date }> } {
  const calls: Array<{ method: string; tenantId: string; start: Date; end: Date }> = [];
  const inWindow = (at: Date | string | undefined, start: Date, end: Date): boolean => {
    const t = at === undefined ? NaN : new Date(at).getTime();
    return Number.isFinite(t) && t >= start.getTime() && t <= end.getTime();
  };

  const store: PriorityStore = {
    async findMissedEnquiries({ tenantId, start, end }) {
      calls.push({ method: 'findMissedEnquiries', tenantId, start, end });
      return missed.filter((event) => event.tenantId === tenantId && inWindow(event.occurredAt, start, end));
    },
    async findPendingCancellations({ tenantId, start, end }) {
      calls.push({ method: 'findPendingCancellations', tenantId, start, end });
      return reservations
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            row.status === 'cancelled' &&
            row.cancellationFollowupSent === false &&
            inWindow(row.cancelledAt, start, end)
        )
        .map((row) => ({ tenantId, partySize: row.partySize ?? 1, cancelledAt: row.cancelledAt as Date }));
    },
    async findPendingNoShows({ tenantId, start, end }) {
      calls.push({ method: 'findPendingNoShows', tenantId, start, end });
      return reservations
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            row.noShowDetected === true &&
            row.noShowFollowupSent === false &&
            inWindow(row.noShowDetectedAt, start, end)
        )
        .map((row) => ({ tenantId, partySize: row.partySize ?? 1, reservationDate: row.date, detectedAt: row.noShowDetectedAt as Date }));
    },
  };

  return { store, calls };
}

/** An in-memory stand-in for the Gate #2 reservation scan. */
function fakeSlowDayStore(rows: SeededReservation[]): SlowDayStore {
  return {
    async findReservations({ tenantId, start, end }) {
      return rows.filter((row) => {
        if (row.tenantId !== tenantId) return false;
        const at = new Date(row.date).getTime();
        return at >= start.getTime() && at < end.getTime();
      });
    },
  };
}

/** 90 days of history plus this week: 4 tables of 3 on every Wednesday, this week down to 1 table of 2. */
function seedWednesdayRows(tenantId: string): SeededReservation[] {
  const window = computeSlowDayWindow(NOW);
  const weekStartKey = toDayKey(window.weekStart)!;
  const weekEndKey = toDayKey(window.weekEnd)!;
  const rows: SeededReservation[] = [];

  for (let i = 0; i < HISTORY_DAYS + WEEK_DAYS; i += 1) {
    const day = new Date(window.historyStart.getTime() + i * MS_DAY);
    if (day.getUTCDay() !== 3) continue; // Wednesday only
    const key = toDayKey(day)!;
    const inThisWeek = key >= weekStartKey && key < weekEndKey;
    const bookings = inThisWeek ? 1 : 4;
    const partySize = inThisWeek ? 2 : 3;
    for (let b = 0; b < bookings; b += 1) {
      rows.push({
        tenantId,
        date: new Date(`${key}T${String(18 + b).padStart(2, '0')}:30:00.000Z`),
        partySize,
        status: 'confirmed',
      });
    }
  }

  return rows;
}

/** A slow-day report from a single collapsed weekday. */
function reportWith(pattern: { dow: number; historyBookings: number; partySize: number; thisWeekBookings: number }): SlowDayReport {
  const window = computeSlowDayWindow(NOW);
  const weekStartKey = toDayKey(window.weekStart)!;
  const weekEndKey = toDayKey(window.weekEnd)!;
  const rows: ReservationLike[] = [];

  for (let i = 0; i < HISTORY_DAYS + WEEK_DAYS; i += 1) {
    const day = new Date(window.historyStart.getTime() + i * MS_DAY);
    if (day.getUTCDay() !== pattern.dow) continue;
    const key = toDayKey(day)!;
    const inThisWeek = key >= weekStartKey && key < weekEndKey;
    const bookings = inThisWeek ? pattern.thisWeekBookings : pattern.historyBookings;
    for (let b = 0; b < bookings; b += 1) {
      rows.push({
        tenantId: TENANT,
        date: new Date(`${key}T${String(18 + (b % 5)).padStart(2, '0')}:${String((b * 7) % 60).padStart(2, '0')}:00.000Z`),
        partySize: pattern.partySize,
        status: 'confirmed',
      });
    }
  }

  return analyzeSlowDays(rows, { now: NOW });
}

/** Per-tenant, per-day aggregates for the super-admin helpers. */
function aggregatesFor(
  now: Date,
  pattern: { dow: number; historyBookings: number; partySize: number; thisWeekBookings: number }
): DayAggregate[] {
  const window = computeSlowDayWindow(now);
  const weekStartKey = toDayKey(window.weekStart)!;
  const weekEndKey = toDayKey(window.weekEnd)!;
  const out: DayAggregate[] = [];

  for (let i = 0; i < HISTORY_DAYS + WEEK_DAYS; i += 1) {
    const day = new Date(window.historyStart.getTime() + i * MS_DAY);
    const key = toDayKey(day)!;
    const inThisWeek = key >= weekStartKey && key < weekEndKey;
    const bookings = day.getUTCDay() === pattern.dow ? (inThisWeek ? pattern.thisWeekBookings : pattern.historyBookings) : 0;
    out.push({ day: key, bookings, guests: bookings * pattern.partySize });
  }

  return out;
}

function opp(type: OpportunityType, score: number, urgency: Urgency): PriorityOpportunity {
  return { opportunity_type: type, description: type, estimated_value_cents: score, priority_score: score, urgency };
}

describe('priority score calculation', () => {
  test('missed_enquiry: estimated value x 0.8 (80% recovery)', () => {
    assert.equal(missedEnquiryScore(50000), 40000);
    assert.equal(missedEnquiryScore(10000), 8000);
    assert.equal(missedEnquiryScore(0), 0);
    assert.equal(missedEnquiryScore(-500), 0);
  });

  test('slow_day: historicalAvg x historicalAvgPartySize x 4900 x 0.3 (30% conversion)', () => {
    const day = { historicalAvg: 4, historicalAvgPartySize: 3 };
    assert.equal(slowDayEstimatedValueCents(day), 58800);
    assert.equal(slowDayScore(day), 17640);
  });

  test('cancellation: party size x 4900 x 0.5 (50% rebook)', () => {
    assert.equal(cancellationValueCents(4), 19600);
    assert.equal(cancellationScore(4), 9800);
  });

  test('no_show: party size x 4900 x 0.4 (40% rebook)', () => {
    assert.equal(noShowValueCents(6), 29400);
    assert.equal(noShowScore(6), 11760);
  });

  test('the average check and the probabilities are the documented defaults', () => {
    assert.equal(AVG_CHECK_CENTS, 4900);
    assert.equal(MAX_PRIORITIES, 3);
  });

  test('average check and probabilities are overridable per caller', () => {
    assert.equal(missedEnquiryScore(10000, { recovery: 0.5 }), 5000);
    assert.equal(slowDayScore({ historicalAvg: 2, historicalAvgPartySize: 2 }, { avgCheckCents: 10000, conversion: 0.5 }), 20000);
    assert.equal(cancellationScore(2, { avgCheckCents: 10000, rebook: 1 }), 20000);
    assert.equal(noShowScore(2, { avgCheckCents: 10000, rebook: 0.25 }), 5000);
  });

  test('a degenerate party size still counts as one seat', () => {
    assert.equal(cancellationValueCents(0), 4900);
    assert.equal(noShowValueCents(0), 4900);
  });
});

describe('urgency and descriptions', () => {
  test('urgency is fixed per type: now, this_week, today, now', () => {
    const priorities = buildPriorities(
      {
        missedEnquiries: [{ estimatedValueCents: 50000, occurredAt: daysAgo(2) }],
        slowDayReport: reportWith({ dow: 6, historyBookings: 4, partySize: 4, thisWeekBookings: 1 }),
        cancellations: [{ partySize: 4, cancelledAt: daysAgo(2) }],
        noShows: [{ partySize: 6, reservationDate: daysAgo(2), detectedAt: daysAgo(1) }],
      },
      { now: NOW, maxPriorities: 10 }
    );
    assert.equal(priorities.find((p) => p.opportunity_type === 'missed_enquiry')?.urgency, 'now');
    assert.equal(priorities.find((p) => p.opportunity_type === 'slow_day')?.urgency, 'this_week');
    assert.equal(priorities.find((p) => p.opportunity_type === 'cancellation')?.urgency, 'today');
    assert.equal(priorities.find((p) => p.opportunity_type === 'no_show')?.urgency, 'now');
  });

  test('descriptions are human-readable actions carrying the event date', () => {
    assert.equal(
      missedEnquiryDescription(new Date('2026-08-22T15:00:00.000Z'), 50000),
      'Call back the customer who asked about a table on Sat 22 Aug and was left without a reply (est. R500)'
    );
    assert.equal(
      cancellationDescription(4, '2026-08-21T10:00:00.000Z'),
      'Offer a rebook to the customer who cancelled their table of 4 on Fri 21 Aug'
    );
    assert.equal(
      noShowDescription(6, '2026-08-22T19:00:00.000Z'),
      'Offer a rebook to the customer who missed their table of 6 on Sat 22 Aug'
    );
    // The slow-day action reuses the Gate #2 recommendation verbatim.
    const report = reportWith({ dow: 6, historyBookings: 4, partySize: 4, thisWeekBookings: 1 });
    const [slowDay] = buildPriorities({ slowDayReport: report }, { now: NOW });
    assert.equal(slowDay.opportunity_type, 'slow_day');
    assert.match(slowDay.description, /^Launch Saturday special campaign now/);
  });
});

describe('ranking: deterministic tie-breaks', () => {
  test('score desc, then urgency (now before today before this_week), then type', () => {
    const priorities = buildPriorities(
      {
        // The first three all score exactly 19600: 10 x 4900 x 0.4,
        // 24500 x 0.8 and 8 x 4900 x 0.5.
        noShows: [{ partySize: 10, reservationDate: daysAgo(1), detectedAt: daysAgo(1) }],
        missedEnquiries: [{ estimatedValueCents: 24500, occurredAt: daysAgo(1) }],
        cancellations: [{ partySize: 8, cancelledAt: daysAgo(1) }],
        slowDayReport: reportWith({ dow: 3, historyBookings: 5, partySize: 2, thisWeekBookings: 1 }),
      },
      { now: NOW, maxPriorities: 10 }
    );

    assert.deepEqual(
      priorities.map((p) => [p.opportunity_type, p.priority_score, p.urgency] as const),
      [
        ['missed_enquiry', 19600, 'now'], // tied with the no-show: 'm' sorts before 'n'
        ['no_show', 19600, 'now'],
        ['cancellation', 19600, 'today'],
        ['slow_day', 14700, 'this_week'], // 5 x 2 x 4900 x 0.3
      ]
    );
  });

  test('a this_week opportunity tied with a today one ranks after it', () => {
    const priorities = buildPriorities(
      {
        // 3 x 4900 x 0.5 = 7350 and 5 x 1 x 4900 x 0.3 = 7350
        cancellations: [{ partySize: 3, cancelledAt: daysAgo(1) }],
        slowDayReport: reportWith({ dow: 3, historyBookings: 5, partySize: 1, thisWeekBookings: 2 }),
      },
      { now: NOW, maxPriorities: 10 }
    );

    assert.deepEqual(priorities.map((p) => p.opportunity_type), ['cancellation', 'slow_day']);
  });

  test('exact ties keep input order (stable sort)', () => {
    const a = { estimatedValueCents: 10000, occurredAt: daysAgo(3) };
    const b = { estimatedValueCents: 10000, occurredAt: daysAgo(1) };

    assert.deepEqual(
      buildPriorities({ missedEnquiries: [a, b] }, { now: NOW }).map((p) => p.description),
      [missedEnquiryDescription(a.occurredAt, 10000), missedEnquiryDescription(b.occurredAt, 10000)]
    );
    assert.deepEqual(
      buildPriorities({ missedEnquiries: [b, a] }, { now: NOW }).map((p) => p.description),
      [missedEnquiryDescription(b.occurredAt, 10000), missedEnquiryDescription(a.occurredAt, 10000)]
    );
  });

  test('comparePriorities: higher score first, then urgency, then type', () => {
    // A negative result means the first argument sorts before the second.
    const first = (a: PriorityOpportunity, b: PriorityOpportunity): boolean => comparePriorities(a, b) < 0;
    assert.ok(first(opp('no_show', 200, 'today'), opp('cancellation', 100, 'now')), 'score beats urgency');
    assert.ok(first(opp('no_show', 100, 'now'), opp('cancellation', 100, 'today')), 'now before today');
    assert.ok(first(opp('cancellation', 100, 'today'), opp('slow_day', 100, 'this_week')), 'today before this_week');
    assert.ok(first(opp('missed_enquiry', 100, 'now'), opp('no_show', 100, 'now')), 'type alpha for exact ties');
    assert.equal(comparePriorities(opp('no_show', 100, 'now'), opp('no_show', 100, 'now')), 0);
  });
});

describe('the top-3 slice', () => {
  const five = {
    missedEnquiries: [
      { estimatedValueCents: 50000, occurredAt: daysAgo(1) }, // 40000
      { estimatedValueCents: 30000, occurredAt: daysAgo(2) }, // 24000
      { estimatedValueCents: 20000, occurredAt: daysAgo(3) }, // 16000
      { estimatedValueCents: 10000, occurredAt: daysAgo(4) }, // 8000
    ],
    noShows: [{ partySize: 4, reservationDate: daysAgo(1), detectedAt: daysAgo(1) }], // 7840
  };

  test('returns at most 3 actions, highest probability-weighted value first', () => {
    const priorities = buildPriorities(five, { now: NOW });
    assert.equal(priorities.length, 3);
    assert.deepEqual(priorities.map((p) => p.priority_score), [40000, 24000, 16000]);
  });

  test('maxPriorities narrows the list', () => {
    assert.equal(buildPriorities(five, { now: NOW, maxPriorities: 1 }).length, 1);
    assert.deepEqual(buildPriorities(five, { now: NOW, maxPriorities: 10 }).map((p) => p.priority_score), [
      40000, 24000, 16000, 8000, 7840,
    ]);
  });

  test('a tenant with nothing to act on gets an empty list, not an error', () => {
    assert.deepEqual(buildPriorities({}, { now: NOW }), []);
  });
});

describe('window and value filters', () => {
  test('opportunities outside the 7-day window are dropped', () => {
    const priorities = buildPriorities(
      {
        missedEnquiries: [
          { estimatedValueCents: 10000, occurredAt: daysAgo(8) },
          { estimatedValueCents: 10000, occurredAt: daysAgo(6) },
        ],
        cancellations: [{ partySize: 2, cancelledAt: daysAgo(8) }],
        noShows: [{ partySize: 2, reservationDate: daysAgo(8), detectedAt: daysAgo(8) }],
      },
      { now: NOW }
    );

    assert.equal(priorities.length, 1);
    assert.equal(priorities[0].opportunity_type, 'missed_enquiry');
  });

  test('the window edge itself still counts; zero-value enquiries are dropped', () => {
    const priorities = buildPriorities(
      {
        missedEnquiries: [
          { estimatedValueCents: 10000, occurredAt: new Date(NOW.getTime() - 7 * MS_DAY) },
          { estimatedValueCents: 0, occurredAt: daysAgo(1) },
          { estimatedValueCents: -2500, occurredAt: daysAgo(1) },
        ],
      },
      { now: NOW }
    );

    assert.equal(priorities.length, 1);
    assert.equal(priorities[0].estimated_value_cents, 10000);
  });

  test('only critical (<50%) slow days become opportunities, never 50-60% ones', () => {
    const window = computeSlowDayWindow(NOW);
    const weekStartKey = toDayKey(window.weekStart)!;
    const weekEndKey = toDayKey(window.weekEnd)!;
    const rows: ReservationLike[] = [];

    for (let i = 0; i < HISTORY_DAYS + WEEK_DAYS; i += 1) {
      const day = new Date(window.historyStart.getTime() + i * MS_DAY);
      const key = toDayKey(day)!;
      const inThisWeek = key >= weekStartKey && key < weekEndKey;
      const dow = day.getUTCDay();
      // Saturday: 1 of 4 -> 25% -> critical. Tuesday: 5 of 10 -> 50% -> slow, not critical.
      const bookings = dow === 6 ? (inThisWeek ? 1 : 4) : dow === 2 ? (inThisWeek ? 5 : 10) : 0;
      const partySize = dow === 6 ? 4 : 2;
      for (let b = 0; b < bookings; b += 1) {
        rows.push({
          tenantId: TENANT,
          date: new Date(`${key}T${String(18 + (b % 5)).padStart(2, '0')}:00:00.000Z`),
          partySize,
          status: 'confirmed',
        });
      }
    }

    const report = analyzeSlowDays(rows, { now: NOW });
    assert.deepEqual(report.days.find((d) => d.day === 'Tuesday')?.flags, ['slow']);
    assert.deepEqual(report.days.find((d) => d.day === 'Saturday')?.flags, ['slow', 'critical']);

    const priorities = buildPriorities({ slowDayReport: report }, { now: NOW });
    assert.equal(priorities.length, 1);
    assert.equal(priorities[0].opportunity_type, 'slow_day');
    assert.match(priorities[0].description, /^Launch Saturday special campaign now/);
  });
});

/**
 * Seed one tenant's raw table data: 90 days of Wednesdays at 4 tables of
 * 3 (this week down to 1), a Saturday no-show awaiting follow-up, a
 * Friday cancellation awaiting follow-up, and a missed-enquiry event
 * worth R500.
 */
function seedTenant(tenantId: string): { reservations: SeededReservation[]; missed: MissedEnquiryLike[] } {
  const reservations: SeededReservation[] = seedWednesdayRows(tenantId);
  reservations.push({
    tenantId,
    date: new Date('2026-08-22T19:00:00.000Z'), // Saturday, table of 6
    partySize: 6,
    status: 'confirmed',
    noShowDetected: true,
    noShowDetectedAt: new Date('2026-08-23T06:00:00.000Z'),
    noShowFollowupSent: false,
  });
  reservations.push({
    tenantId,
    date: new Date('2026-08-21T19:00:00.000Z'),
    partySize: 4,
    status: 'cancelled',
    cancelledAt: new Date('2026-08-21T10:00:00.000Z'),
    cancellationFollowupSent: false,
  });
  const missed: MissedEnquiryLike[] = [
    { tenantId, estimatedValueCents: 50000, occurredAt: new Date('2026-08-22T15:00:00.000Z') },
  ];
  return { reservations, missed };
}

describe('E2E: create a missed enquiry, a critical slow day, a no-show and a cancellation', () => {
  test('ranks 40000 > 17640 > 11760 and slices the 4th (9800) off', async () => {
    const { reservations, missed } = seedTenant(TENANT);

    // The exact path the summary route runs: Gate #2 report first, then
    // the priorities over it, through the store boundary.
    const slowDayReport = await detectSlowDaysForTenant(fakeSlowDayStore(reservations), TENANT, { now: NOW });
    const { store, calls } = fakePriorityStore(missed, reservations);
    const top3 = await buildTenantPriorities(store, TENANT, slowDayReport, { now: NOW });

    assert.deepEqual(
      top3.map((p) => [p.opportunity_type, p.priority_score, p.estimated_value_cents, p.urgency] as const),
      [
        ['missed_enquiry', 40000, 50000, 'now'], // 50000 x 0.8
        ['slow_day', 17640, 58800, 'this_week'], // 4 x 3 x 4900 x 0.3
        ['no_show', 11760, 29400, 'now'], // 6 x 4900 x 0.4
      ]
    );

    // The store was asked about exactly this tenant, over exactly the 7-day window.
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.tenantId === TENANT));
    assert.equal(calls[0].start.toISOString(), new Date(NOW.getTime() - 7 * MS_DAY).toISOString());
    assert.equal(calls[0].end.toISOString(), NOW.toISOString());

    // The same opportunities un-sliced prove the cancellation exists and
    // is exactly what gets dropped: party of 4 -> 4 x 4900 x 0.5 = 9800.
    const all = await buildTenantPriorities(store, TENANT, slowDayReport, { now: NOW, maxPriorities: 10 });
    assert.deepEqual(
      all.map((p) => [p.opportunity_type, p.priority_score] as const),
      [
        ['missed_enquiry', 40000],
        ['slow_day', 17640],
        ['no_show', 11760],
        ['cancellation', 9800],
      ]
    );
  });

  test('the top action reads as a human instruction, not an id', async () => {
    const { reservations, missed } = seedTenant(TENANT);
    const slowDayReport = await detectSlowDaysForTenant(fakeSlowDayStore(reservations), TENANT, { now: NOW });
    const { store } = fakePriorityStore(missed, reservations);
    const [top] = await buildTenantPriorities(store, TENANT, slowDayReport, { now: NOW });

    assert.equal(top.opportunity_type, 'missed_enquiry');
    assert.equal(
      top.description,
      'Call back the customer who asked about a table on Sat 22 Aug and was left without a reply (est. R500)'
    );
  });
});

describe('tenant isolation', () => {
  test('a tenant never sees another tenant opportunities, in either direction', async () => {
    const mine = seedTenant(TENANT);
    const theirs = seedTenant(RIVAL);
    theirs.missed[0].estimatedValueCents = 999999; // must never leak into mine

    const reservations = [...mine.reservations, ...theirs.reservations];
    const missed = [...mine.missed, ...theirs.missed];
    const { store, calls } = fakePriorityStore(missed, reservations);

    const myReport = await detectSlowDaysForTenant(fakeSlowDayStore(reservations), TENANT, { now: NOW });
    const minePriorities = await buildTenantPriorities(store, TENANT, myReport, { now: NOW });

    // Every store call was scoped to this tenant.
    assert.deepEqual(calls.map((c) => c.tenantId), [TENANT, TENANT, TENANT]);
    // And nothing from the rival leaked in - the 999999-cent enquiry
    // would be #1 if it had.
    assert.ok(minePriorities.every((p) => p.priority_score <= 40000), 'rival data leaked into this tenant priorities');
    assert.deepEqual(
      minePriorities.map((p) => [p.opportunity_type, p.priority_score] as const),
      [
        ['missed_enquiry', 40000],
        ['slow_day', 17640],
        ['no_show', 11760],
      ]
    );

    // In the other direction: the rival sees its own (huge) enquiry.
    const rivalReport = await detectSlowDaysForTenant(fakeSlowDayStore(reservations), RIVAL, { now: NOW });
    const theirsPriorities = await buildTenantPriorities(store, RIVAL, rivalReport, { now: NOW });
    assert.deepEqual(calls.map((c) => c.tenantId), [TENANT, TENANT, TENANT, RIVAL, RIVAL, RIVAL]);
    assert.equal(theirsPriorities[0].opportunity_type, 'missed_enquiry');
    assert.equal(theirsPriorities[0].priority_score, Math.round(999999 * 0.8));
  });

  test('another tenants critical slow day never becomes this tenants opportunity', async () => {
    // Mine: Wednesdays at full strength (4 of 4 -> 100% -> no flag).
    // Rival: Wednesday collapsed (1 of 4 -> 25% -> critical).
    const window = computeSlowDayWindow(NOW);
    const weekStartKey = toDayKey(window.weekStart)!;
    const weekEndKey = toDayKey(window.weekEnd)!;
    const rows: SeededReservation[] = [];

    for (const [tenantId, thisWeekBookings] of [[TENANT, 4], [RIVAL, 1]] as const) {
      for (let i = 0; i < HISTORY_DAYS + WEEK_DAYS; i += 1) {
        const day = new Date(window.historyStart.getTime() + i * MS_DAY);
        if (day.getUTCDay() !== 3) continue;
        const key = toDayKey(day)!;
        const inThisWeek = key >= weekStartKey && key < weekEndKey;
        const bookings = inThisWeek ? thisWeekBookings : 4;
        for (let b = 0; b < bookings; b += 1) {
          rows.push({ tenantId, date: new Date(`${key}T19:00:00.000Z`), partySize: 3, status: 'confirmed' });
        }
      }
    }

    const myReport = await detectSlowDaysForTenant(fakeSlowDayStore(rows), TENANT, { now: NOW });
    assert.deepEqual(myReport.criticalSlowDays, []);
    const { store } = fakePriorityStore([], rows);
    const priorities = await buildTenantPriorities(store, TENANT, myReport, { now: NOW });
    assert.deepEqual(priorities, []);

    const rivalReport = await detectSlowDaysForTenant(fakeSlowDayStore(rows), RIVAL, { now: NOW });
    assert.equal(rivalReport.criticalSlowDays.length, 1);
  });
});

describe('super-admin: totalTopPriorityValueCents over the shared slow-day aggregates', () => {
  const aggregatesByTenant = new Map<string, DayAggregate[]>([
    // Wednesday collapsed to 25% of a 4-table-of-3 average: 4 x 3 x 4900 = 58800.
    ['tenant-a', aggregatesFor(MIDNIGHT, { dow: 3, historyBookings: 4, partySize: 3, thisWeekBookings: 1 })],
    // Wednesday collapsed to 40% of a 5-table-of-2 average: 5 x 2 x 4900 = 49000.
    ['tenant-b', aggregatesFor(MIDNIGHT, { dow: 3, historyBookings: 5, partySize: 2, thisWeekBookings: 2 })],
    // Healthy week: nothing to act on, contributes 0.
    ['tenant-c', aggregatesFor(MIDNIGHT, { dow: 3, historyBookings: 4, partySize: 3, thisWeekBookings: 4 })],
  ]);

  test('sums each tenant top-priority value (healthy tenants contribute 0)', () => {
    assert.deepEqual(
      topPriorityValueCentsByTenant(aggregatesByTenant, { now: MIDNIGHT }),
      new Map([
        ['tenant-a', 58800],
        ['tenant-b', 49000],
        ['tenant-c', 0],
      ])
    );
    assert.equal(totalTopPriorityValueCents(aggregatesByTenant, { now: MIDNIGHT }), 107800);
  });

  test('an empty map (a failed fetch) is 0, not an error', () => {
    assert.equal(totalTopPriorityValueCents(new Map(), { now: MIDNIGHT }), 0);
    assert.deepEqual(topPriorityValueCentsByTenant(new Map(), { now: MIDNIGHT }), new Map());
  });

  test('a tenant with several critical days contributes only its best', () => {
    // Two collapsed weekdays: Wed 1 of 4 tables of 3 (58800), Sat 1 of 5 tables of 2 (49000).
    const out = aggregatesFor(MIDNIGHT, { dow: 3, historyBookings: 4, partySize: 3, thisWeekBookings: 1 });
    const window = computeSlowDayWindow(MIDNIGHT);
    const weekStartKey = toDayKey(window.weekStart)!;
    const weekEndKey = toDayKey(window.weekEnd)!;
    for (let i = 0; i < HISTORY_DAYS + WEEK_DAYS; i += 1) {
      const day = new Date(window.historyStart.getTime() + i * MS_DAY);
      const key = toDayKey(day)!;
      if (day.getUTCDay() !== 6) continue;
      const inThisWeek = key >= weekStartKey && key < weekEndKey;
      const bookings = inThisWeek ? 1 : 5;
      out.push({ day: key, bookings, guests: bookings * 2 });
    }

    assert.equal(totalTopPriorityValueCents(new Map([['tenant-a', out]]), { now: MIDNIGHT }), 58800);
  });

  test('mocked clock: stable at UTC midnight, and identical at any time of the same UTC day', () => {
    const a = totalTopPriorityValueCents(aggregatesByTenant, { now: MIDNIGHT });
    const b = totalTopPriorityValueCents(aggregatesByTenant, { now: MIDNIGHT });
    assert.equal(a, b);
    assert.equal(a, 107800);

    // The window is day-granular: 07:00 and 23:59 on the same UTC day must
    // give the same answer as midnight.
    assert.equal(totalTopPriorityValueCents(aggregatesByTenant, { now: new Date('2026-08-24T07:00:00.000Z') }), a);
    assert.equal(totalTopPriorityValueCents(aggregatesByTenant, { now: new Date('2026-08-24T23:59:59.000Z') }), a);

    // ...and a different day changes the answer (the window is read, not a frozen value).
    assert.notEqual(totalTopPriorityValueCents(aggregatesByTenant, { now: new Date('2026-08-31T00:00:00.000Z') }), a);
  });
});

describe('mocked-clock stability of the tenant pass', () => {
  test('buildPriorities and buildTenantPriorities are deterministic for a fixed now', async () => {
    const inputs = {
      missedEnquiries: [{ estimatedValueCents: 50000, occurredAt: daysAgo(2) }],
      slowDayReport: reportWith({ dow: 6, historyBookings: 4, partySize: 4, thisWeekBookings: 1 }),
      noShows: [{ partySize: 6, reservationDate: daysAgo(2), detectedAt: daysAgo(1) }],
    };
    assert.deepEqual(buildPriorities(inputs, { now: NOW }), buildPriorities(inputs, { now: NOW }));

    const reservations = seedWednesdayRows(TENANT);
    const missed = [{ tenantId: TENANT, estimatedValueCents: 50000, occurredAt: daysAgo(2) }];
    const report = await detectSlowDaysForTenant(fakeSlowDayStore(reservations), TENANT, { now: NOW });
    const first = await buildTenantPriorities(fakePriorityStore(missed, reservations).store, TENANT, report, { now: NOW });
    const second = await buildTenantPriorities(fakePriorityStore(missed, reservations).store, TENANT, report, { now: NOW });
    assert.deepEqual(first, second);
  });
});
