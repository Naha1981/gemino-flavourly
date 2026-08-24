import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPPORTUNITY_WINDOW_DAYS,
  buildTenantOpportunity,
  calculatePlatformOpportunity,
  summarizeOpportunity,
  summarizeOpportunityValues,
  type MissedEnquiryLike,
  type OpportunityInputs,
  type OpportunityStore,
} from './opportunity.ts';
import {
  HISTORY_DAYS,
  WEEK_DAYS,
  computeSlowDayWindow,
  detectSlowDaysForTenant,
  toDayKey,
  type DayAggregate,
  type ReservationLike,
  type SlowDayInsight,
  type SlowDayReport,
  type SlowDayStore,
} from './slow-days.ts';

/**
 * Gate #6 tests.
 *
 * opportunity.ts is framework-free, so the unit tests exercise the real
 * component sums and the shared summary math directly; the "integration"
 * and "E2E" sections run the exact path the /api/revenue/summary route
 * runs (detectSlowDaysForTenant, then buildTenantOpportunity through a
 * fake store seeded with raw table rows) and pin the full opportunity
 * summary. The platform section proves the super-admin total is the sum
 * of each tenant's own total, the tenant-isolation section proves one
 * restaurant's revenue can never leak into another's, and the
 * mocked-clock section proves the summary is stable when the clock is
 * pinned.
 */

/** A Monday at 07:00 UTC — the same moment the daily brief cron runs. */
const NOW = new Date('2026-08-24T07:00:00.000Z');
const MS_DAY = 24 * 60 * 60 * 1000;
const TENANT = 'tenant-bistro';
const RIVAL = 'tenant-rival';

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_DAY);
}

function daysAhead(days: number): Date {
  return new Date(NOW.getTime() + days * MS_DAY);
}

/** A minimal Gate #2 report with one critical slow day. */
function criticalReport(historicalAvg: number, partySize: number): SlowDayReport {
  const day: SlowDayInsight = {
    day: 'Wednesday',
    dayOfWeek: 3,
    date: '2026-08-19',
    currentBookings: 0,
    historicalAvg,
    occupancy: '25%',
    occupancyRatio: 0.25,
    flags: ['critical'],
    recommendation: 'Launch Wednesday special campaign now',
    currentGuests: 0,
    currentAvgPartySize: 0,
    historicalAvgGuests: 0,
    historicalAvgPartySize: partySize,
  };
  return {
    window: { weekStart: '', weekEnd: '', historyStart: '', historyEnd: '' },
    days: [],
    slowDays: [],
    criticalSlowDays: [day],
  };
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
 * An in-memory stand-in for the three opportunity scans. Like the Drizzle
 * adapter it filters by tenant AND window, so a wrong window or a missing
 * tenant scope shows up as missing data instead of silently passing.
 */
function fakeOpportunityStore(
  missed: MissedEnquiryLike[],
  reservations: SeededReservation[]
): { store: OpportunityStore; calls: Array<{ method: string; tenantId: string; start: Date; end: Date }> } {
  const calls: Array<{ method: string; tenantId: string; start: Date; end: Date }> = [];
  const inWindow = (at: Date | string | undefined, start: Date, end: Date): boolean => {
    const t = at === undefined ? NaN : new Date(at).getTime();
    return Number.isFinite(t) && t >= start.getTime() && t <= end.getTime();
  };

  const store: OpportunityStore = {
    async findMissedEnquiries({ tenantId, start, end }) {
      calls.push({ method: 'findMissedEnquiries', tenantId, start, end });
      return missed.filter((event) => event.tenantId === tenantId && inWindow(event.occurredAt, start, end));
    },
    async findCancellations({ tenantId, start, end }) {
      calls.push({ method: 'findCancellations', tenantId, start, end });
      return reservations
        .filter(
          (row) =>
            row.tenantId === tenantId && row.status === 'cancelled' && inWindow(row.cancelledAt, start, end)
        )
        .map((row) => ({ tenantId, partySize: row.partySize ?? 1, cancelledAt: row.cancelledAt as Date }));
    },
    async findNoShows({ tenantId, start, end }) {
      calls.push({ method: 'findNoShows', tenantId, start, end });
      return reservations
        .filter(
          (row) => row.tenantId === tenantId && row.noShowDetected === true && inWindow(row.noShowDetectedAt, start, end)
        )
        .map((row) => ({ tenantId, partySize: row.partySize ?? 1, detectedAt: row.noShowDetectedAt as Date }));
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

/** 90 days of Wednesdays at 4 tables of 3, this week collapsed to 1 of 2. */
function seedWednesdayRows(tenantId: string): SeededReservation[] {
  const window = computeSlowDayWindow(NOW);
  const weekStartKey = toDayKey(window.weekStart)!;
  const weekEndKey = toDayKey(window.weekEnd)!;
  const rows: SeededReservation[] = [];

  for (let i = 0; i < HISTORY_DAYS + WEEK_DAYS; i += 1) {
    const day = new Date(window.historyStart.getTime() + i * MS_DAY);
    if (day.getUTCDay() !== 3) continue;
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

/** One tenant's full opportunity set: all four types, all inside the window. */
function seedTenant(tenantId: string): { reservations: SeededReservation[]; missed: MissedEnquiryLike[] } {
  const reservations: SeededReservation[] = seedWednesdayRows(tenantId);
  reservations.push({
    tenantId,
    date: new Date('2026-08-22T19:00:00.000Z'),
    partySize: 6,
    status: 'confirmed',
    noShowDetected: true,
    noShowDetectedAt: new Date('2026-08-23T06:00:00.000Z'),
    noShowFollowupSent: true,
  });
  reservations.push({
    tenantId,
    date: new Date('2026-08-21T19:00:00.000Z'),
    partySize: 4,
    status: 'cancelled',
    cancelledAt: new Date('2026-08-21T10:00:00.000Z'),
    cancellationFollowupSent: true,
  });
  const missed: MissedEnquiryLike[] = [
    { tenantId, estimatedValueCents: 50000, occurredAt: new Date('2026-08-22T15:00:00.000Z') },
  ];
  return { reservations, missed };
}

describe('unit: the four components', () => {
  test('missed_enquiry_value: sum of positive estimated values in the window', () => {
    const summary = summarizeOpportunity(
      {
        missedEnquiries: [
          { estimatedValueCents: 50000, occurredAt: daysAgo(2) },
          { estimatedValueCents: 30000, occurredAt: daysAgo(1) },
          { estimatedValueCents: 0, occurredAt: daysAgo(1) },
          { estimatedValueCents: -2500, occurredAt: daysAgo(1) },
          { estimatedValueCents: 99999, occurredAt: daysAgo(40) },
        ],
      },
      { now: NOW }
    );

    assert.equal(summary.missed_enquiry_value, 80000);
    assert.equal(summary.slow_day_value, 0);
    assert.equal(summary.cancellation_value, 0);
    assert.equal(summary.no_show_value, 0);
    assert.equal(summary.total_opportunity_cents, 80000);
  });

  test('slow_day_value: slowDayScore summed over critical slow days only', () => {
    const summary = summarizeOpportunity(
      {
        // Critical (under 50%): 4 x 3 x 4900 x 0.3 = 17640.
        slowDayReport: criticalReport(4, 3),
      },
      { now: NOW }
    );

    assert.equal(summary.slow_day_value, 17640);
    assert.equal(summary.total_opportunity_cents, 17640);
  });

  test('slow_day_value: 50-60% non-critical days are not opportunities', () => {
    const day: SlowDayInsight = {
      day: 'Tuesday',
      dayOfWeek: 2,
      date: '2026-08-18',
      currentBookings: 5,
      historicalAvg: 10,
      occupancy: '50%',
      occupancyRatio: 0.5,
      flags: ['slow'],
      recommendation: 'Launch Tuesday special campaign',
      currentGuests: 10,
      currentAvgPartySize: 2,
      historicalAvgGuests: 20,
      historicalAvgPartySize: 2,
    };
    const report: SlowDayReport = {
      window: { weekStart: '', weekEnd: '', historyStart: '', historyEnd: '' },
      days: [],
      slowDays: [day],
      criticalSlowDays: [],
    };

    const summary = summarizeOpportunity({ slowDayReport: report }, { now: NOW });
    assert.equal(summary.slow_day_value, 0);
    assert.equal(summary.total_opportunity_cents, 0);
  });

  test('cancellation_value: party size x 4900 x 0.5, windowed on cancelled_at', () => {
    const summary = summarizeOpportunity(
      {
        cancellations: [
          { partySize: 4, cancelledAt: daysAgo(2) },
          { partySize: 2, cancelledAt: daysAgo(40) },
          { partySize: 6, cancelledAt: daysAhead(1) },
        ],
      },
      { now: NOW }
    );

    // 4 -> 19600 x 0.5 = 9800; the outside-window rows are dropped.
    assert.equal(summary.cancellation_value, 9800);
    assert.equal(summary.total_opportunity_cents, 9800);
  });

  test('no_show_value: party size x 4900 x 0.4, windowed on no_show_detected_at', () => {
    const summary = summarizeOpportunity(
      {
        noShows: [
          { partySize: 6, detectedAt: daysAgo(1) },
          { partySize: 2, detectedAt: daysAgo(40) },
        ],
      },
      { now: NOW }
    );

    // 6 -> 29400 x 0.4 = 11760; the outside-window row is dropped.
    assert.equal(summary.no_show_value, 11760);
    assert.equal(summary.total_opportunity_cents, 11760);
  });

  test('the average check and the window default to 4900 and 30 days', () => {
    assert.equal(OPPORTUNITY_WINDOW_DAYS, 30);
    const summary = summarizeOpportunity(
      {
        cancellations: [{ partySize: 2, cancelledAt: daysAgo(30) }],
      },
      { now: NOW }
    );
    // 2 x 4900 x 0.5 = 4900, and the 30-day edge itself still counts.
    assert.equal(summary.cancellation_value, 4900);
  });

  test('average check and probabilities are overridable per caller', () => {
    const summary = summarizeOpportunity(
      {
        missedEnquiries: [{ estimatedValueCents: 10000, occurredAt: daysAgo(1) }],
        slowDayReport: criticalReport(2, 2),
        cancellations: [{ partySize: 2, cancelledAt: daysAgo(1) }],
        noShows: [{ partySize: 2, detectedAt: daysAgo(1) }],
      },
      {
        now: NOW,
        avgCheckCents: 10000,
        missedEnquiryRecovery: 0.5,
        slowDayConversion: 0.5,
        cancellationRebook: 1,
        noShowRebook: 0.25,
      }
    );
    // missed: 10000, slow: 2x2x10000x0.5=20000, cancel: 2x10000x1=20000, noShow: 2x10000x0.25=5000
    assert.equal(summary.missed_enquiry_value, 10000);
    assert.equal(summary.slow_day_value, 20000);
    assert.equal(summary.cancellation_value, 20000);
    assert.equal(summary.no_show_value, 5000);
    assert.equal(summary.total_opportunity_cents, 55000);
  });

  test('a degenerate party size still counts as one seat', () => {
    const summary = summarizeOpportunity(
      { cancellations: [{ partySize: 0, cancelledAt: daysAgo(1) }] },
      { now: NOW }
    );
    // One seat x 4900 x 0.5 = 2450, exactly like Gate #5's cancellationScore.
    assert.equal(summary.cancellation_value, 2450);
  });
});

describe('unit: the shared summary math', () => {
  test('total is the sum of the four components', () => {
    const summary = summarizeOpportunity(
      {
        missedEnquiries: [{ estimatedValueCents: 50000, occurredAt: daysAgo(2) }],
        slowDayReport: criticalReport(4, 3),
        cancellations: [{ partySize: 4, cancelledAt: daysAgo(1) }],
        noShows: [{ partySize: 6, detectedAt: daysAgo(1) }],
      },
      { now: NOW }
    );

    assert.equal(summary.missed_enquiry_value, 50000);
    assert.equal(summary.slow_day_value, 17640);
    assert.equal(summary.cancellation_value, 9800);
    assert.equal(summary.no_show_value, 11760);
    assert.equal(summary.total_opportunity_cents, 89200);
  });

  test('recovery_probability is the value-weighted average and expected is total x probability', () => {
    const summary = summarizeOpportunity(
      {
        missedEnquiries: [{ estimatedValueCents: 50000, occurredAt: daysAgo(2) }],
        slowDayReport: criticalReport(4, 3),
        cancellations: [{ partySize: 4, cancelledAt: daysAgo(1) }],
        noShows: [{ partySize: 6, detectedAt: daysAgo(1) }],
      },
      { now: NOW }
    );

    // (50000*0.8 + 17640*0.3 + 9800*0.5 + 11760*0.4) / 89200
    assert.equal(summary.recovery_probability, 0.6154);
    assert.equal(summary.expected_recovery_cents, 54896);
  });

  test('a single component yields its own recovery probability', () => {
    assert.equal(summarizeOpportunityValues({ missed_enquiry_value: 100, slow_day_value: 0, cancellation_value: 0, no_show_value: 0 }).recovery_probability, 0.8);
    assert.equal(summarizeOpportunityValues({ missed_enquiry_value: 0, slow_day_value: 100, cancellation_value: 0, no_show_value: 0 }).recovery_probability, 0.3);
    assert.equal(summarizeOpportunityValues({ missed_enquiry_value: 0, slow_day_value: 0, cancellation_value: 100, no_show_value: 0 }).recovery_probability, 0.5);
    assert.equal(summarizeOpportunityValues({ missed_enquiry_value: 0, slow_day_value: 0, cancellation_value: 0, no_show_value: 100 }).recovery_probability, 0.4);
  });

  test('a tenant with nothing open has zeros, not an error', () => {
    assert.deepEqual(summarizeOpportunity({}, { now: NOW }), {
      missed_enquiry_value: 0,
      slow_day_value: 0,
      cancellation_value: 0,
      no_show_value: 0,
      total_opportunity_cents: 0,
      recovery_probability: 0,
      expected_recovery_cents: 0,
    });
  });

  test('components are rounded to whole cents', () => {
    const summary = summarizeOpportunityValues({
      missed_enquiry_value: 10.6,
      slow_day_value: 10.4,
      cancellation_value: 10.5,
      no_show_value: 10.5,
    });
    assert.equal(summary.missed_enquiry_value, 11);
    assert.equal(summary.slow_day_value, 10);
    assert.equal(summary.cancellation_value, 11);
    assert.equal(summary.no_show_value, 11);
    assert.equal(summary.total_opportunity_cents, 43);
  });
});

/**
 * The exact path the /api/revenue/summary route and the daily brief run:
 * the Gate #2 report is produced first (or handed in), then the three
 * tenant-scoped scans run through the store boundary, then the summary.
 */
describe('integration (full route path): all four types through the store boundary', () => {
  test('returns the complete opportunity summary from the tenant scans', async () => {
    const { reservations, missed } = seedTenant(TENANT);

    const slowDayReport = await detectSlowDaysForTenant(fakeSlowDayStore(reservations), TENANT, { now: NOW });
    const { store, calls } = fakeOpportunityStore(missed, reservations);
    const summary = await buildTenantOpportunity(store, TENANT, slowDayReport, { now: NOW });

    assert.deepEqual(summary, {
      missed_enquiry_value: 50000,
      slow_day_value: 17640, // 4 x 3 x 4900 x 0.3
      cancellation_value: 9800, // 4 x 4900 x 0.5
      no_show_value: 11760, // 6 x 4900 x 0.4
      total_opportunity_cents: 89200,
      recovery_probability: 0.6154,
      expected_recovery_cents: 54896,
    });

    // The store was asked about exactly this tenant, over the 30-day window.
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.tenantId === TENANT));
    assert.equal(calls[0].start.toISOString(), new Date(NOW.getTime() - 30 * MS_DAY).toISOString());
    assert.equal(calls[0].end.toISOString(), NOW.toISOString());
  });

  test('E2E: all four types show up and the total is their sum', async () => {
    const { reservations, missed } = seedTenant(TENANT);
    const report = await detectSlowDaysForTenant(fakeSlowDayStore(reservations), TENANT, { now: NOW });
    const { store } = fakeOpportunityStore(missed, reservations);
    const summary = await buildTenantOpportunity(store, TENANT, report, { now: NOW });

    const components = [
      summary.missed_enquiry_value,
      summary.slow_day_value,
      summary.cancellation_value,
      summary.no_show_value,
    ];
    assert.equal(summary.total_opportunity_cents, components.reduce((a, b) => a + b, 0));
    // Each component is non-zero, so the four types are all present.
    assert.ok(components.every((value) => value > 0));
  });

  test('a reservation that was already followed up still counts', async () => {
    // seedTenant marks both follow-up flags true on purpose.
    const { reservations, missed } = seedTenant(TENANT);
    const report = await detectSlowDaysForTenant(fakeSlowDayStore(reservations), TENANT, { now: NOW });
    const { store } = fakeOpportunityStore(missed, reservations);
    const summary = await buildTenantOpportunity(store, TENANT, report, { now: NOW });

    assert.equal(summary.cancellation_value, 9800);
    assert.equal(summary.no_show_value, 11760);
  });
});

describe('super-admin: calculatePlatformOpportunity over the shared inputs', () => {
  function inputsFor(tenantId: string, missedCents: number): OpportunityInputs {
    return {
      missedEnquiries: [{ tenantId, estimatedValueCents: missedCents, occurredAt: daysAgo(1) }],
    };
  }

  test('platform total is the sum of each tenant own total', () => {
    const inputsByTenant = new Map<string, OpportunityInputs>([
      [
        'tenant-a',
        {
          missedEnquiries: [{ tenantId: 'tenant-a', estimatedValueCents: 50000, occurredAt: daysAgo(1) }],
          slowDayReport: criticalReport(4, 3),
          cancellations: [{ tenantId: 'tenant-a', partySize: 4, cancelledAt: daysAgo(1) }],
          noShows: [{ tenantId: 'tenant-a', partySize: 6, detectedAt: daysAgo(1) }],
        },
      ],
      ['tenant-b', inputsFor('tenant-b', 30000)],
      ['tenant-c', {}],
    ]);

    const perTenant = Array.from(inputsByTenant.values(), (inputs) => summarizeOpportunity(inputs, { now: NOW }));
    const eachTenantTotal = perTenant.reduce((sum, s) => sum + s.total_opportunity_cents, 0);
    const platform = calculatePlatformOpportunity(inputsByTenant, { now: NOW });

    assert.equal(platform.total_opportunity_cents, eachTenantTotal);
    // 89200 + 30000 + 0
    assert.equal(platform.total_opportunity_cents, 119200);
    assert.equal(platform.expected_recovery_cents, 54896 + 24000);
    assert.equal(platform.recovery_probability, 0.6619);
  });

  test('the Gate #2 per-tenant aggregates (already fetched) feed the slow-day component', () => {
    // A platform where tenant-a has a critical Wednesday and tenant-b is
    // healthy. The slow-day value must come from the aggregates map, not
    // from a re-read of the reservation table.
    const aggregatesByTenant = new Map<string, DayAggregate[]>([
      ['tenant-a', aggregatesFor(NOW, { dow: 3, historyBookings: 4, partySize: 3, thisWeekBookings: 1 })],
      ['tenant-b', aggregatesFor(NOW, { dow: 3, historyBookings: 4, partySize: 3, thisWeekBookings: 4 })],
    ]);
    const inputsByTenant = new Map<string, OpportunityInputs>([
      ['tenant-a', {}],
      ['tenant-b', {}],
    ]);

    const platform = calculatePlatformOpportunity(inputsByTenant, {
      now: NOW,
      slowDayAggregatesByTenant: aggregatesByTenant,
    });

    assert.equal(platform.slow_day_value, 17640);
    assert.equal(platform.total_opportunity_cents, 17640);
  });

  test('an empty map (a failed fetch) is 0, not an error', () => {
    assert.deepEqual(calculatePlatformOpportunity(new Map(), { now: NOW }), {
      missed_enquiry_value: 0,
      slow_day_value: 0,
      cancellation_value: 0,
      no_show_value: 0,
      total_opportunity_cents: 0,
      recovery_probability: 0,
      expected_recovery_cents: 0,
    });
  });

  test('a tenant with several critical days sums each one', () => {
    const wednesday = criticalReport(4, 3);
    const saturday = criticalReport(5, 2);
    saturday.criticalSlowDays = [];
    saturday.criticalSlowDays.push({
      day: 'Saturday',
      dayOfWeek: 6,
      date: '2026-08-22',
      currentBookings: 0,
      historicalAvg: 5,
      occupancy: '20%',
      occupancyRatio: 0.2,
      flags: ['critical'],
      recommendation: 'Launch Saturday special campaign now',
      currentGuests: 0,
      currentAvgPartySize: 0,
      historicalAvgGuests: 0,
      historicalAvgPartySize: 2,
    });
    const report: SlowDayReport = {
      ...wednesday,
      criticalSlowDays: [...wednesday.criticalSlowDays, ...saturday.criticalSlowDays],
    };

    const summary = summarizeOpportunity({ slowDayReport: report }, { now: NOW });
    // 4x3x4900x0.3 = 17640, 5x2x4900x0.3 = 14700
    assert.equal(summary.slow_day_value, 32340);
  });
});

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

describe('tenant isolation', () => {
  test('a tenant never sees another tenant opportunity value, in either direction', async () => {
    const mine = seedTenant(TENANT);
    const theirs = seedTenant(RIVAL);
    theirs.missed[0].estimatedValueCents = 99999900; // must never leak into mine

    const reservations = [...mine.reservations, ...theirs.reservations];
    const missed = [...mine.missed, ...theirs.missed];
    const { store, calls } = fakeOpportunityStore(missed, reservations);

    const myReport = await detectSlowDaysForTenant(fakeSlowDayStore(reservations), TENANT, { now: NOW });
    const mineSummary = await buildTenantOpportunity(store, TENANT, myReport, { now: NOW });

    // Every store call was scoped to this tenant.
    assert.deepEqual(calls.map((c) => c.tenantId), [TENANT, TENANT, TENANT]);
    // And nothing from the rival leaked in — the 99999900-cent enquiry
    // would dwarf every component if it had.
    assert.equal(mineSummary.missed_enquiry_value, 50000);

    // In the other direction: the rival sees its own (huge) enquiry.
    const rivalReport = await detectSlowDaysForTenant(fakeSlowDayStore(reservations), RIVAL, { now: NOW });
    const theirsSummary = await buildTenantOpportunity(store, RIVAL, rivalReport, { now: NOW });
    assert.deepEqual(calls.map((c) => c.tenantId), [TENANT, TENANT, TENANT, RIVAL, RIVAL, RIVAL]);
    assert.equal(theirsSummary.missed_enquiry_value, 99999900);
  });

  test('another tenant critical slow day never becomes this tenant opportunity', async () => {
    // Mine: Wednesday at full strength -> no flag. Rival: collapsed.
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
    const { store } = fakeOpportunityStore([], rows);
    const summary = await buildTenantOpportunity(store, TENANT, myReport, { now: NOW });
    assert.equal(summary.slow_day_value, 0);
    assert.equal(summary.total_opportunity_cents, 0);

    const rivalReport = await detectSlowDaysForTenant(fakeSlowDayStore(rows), RIVAL, { now: NOW });
    assert.equal(rivalReport.criticalSlowDays.length, 1);
  });
});

describe('window edges and deterministic math', () => {
  test('a row exactly at the window edge counts; one past it does not', async () => {
    const missed: MissedEnquiryLike[] = [
      { tenantId: TENANT, estimatedValueCents: 10000, occurredAt: new Date(NOW.getTime() - 30 * MS_DAY) },
      { tenantId: TENANT, estimatedValueCents: 10000, occurredAt: new Date(NOW.getTime() - 31 * MS_DAY) },
    ];
    const { store } = fakeOpportunityStore(missed, []);
    const summary = await buildTenantOpportunity(store, TENANT, criticalReport(0, 1), { now: NOW });

    assert.equal(summary.missed_enquiry_value, 10000);
  });

  test('a zero-value/ negative missed enquiry cannot inflate the total', () => {
    const summary = summarizeOpportunity(
      {
        missedEnquiries: [
          { estimatedValueCents: 0, occurredAt: daysAgo(1) },
          { estimatedValueCents: -500, occurredAt: daysAgo(1) },
        ],
      },
      { now: NOW }
    );
    assert.equal(summary.missed_enquiry_value, 0);
    assert.equal(summary.total_opportunity_cents, 0);
  });

  test('mocked clock: deterministic for a fixed now, and day-granular', () => {
    const inputs = {
      missedEnquiries: [{ estimatedValueCents: 50000, occurredAt: daysAgo(2) }],
      slowDayReport: criticalReport(4, 3),
      cancellations: [{ partySize: 4, cancelledAt: daysAgo(1) }],
      noShows: [{ partySize: 6, detectedAt: daysAgo(1) }],
    };
    assert.deepEqual(summarizeOpportunity(inputs, { now: NOW }), summarizeOpportunity(inputs, { now: NOW }));

    // Passing an explicit window is required for stability: every caller
    // that cares about "now" must hand it in.
    const first = summarizeOpportunity(inputs, { now: new Date('2026-08-24T07:00:00.000Z') });
    const second = summarizeOpportunity(inputs, { now: new Date('2026-08-24T23:59:59.000Z') });
    assert.deepEqual(first, second);
  });
});
