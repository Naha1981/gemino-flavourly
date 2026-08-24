import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDayAggregates,
  analyzeSlowDays,
  computeSlowDayWindow,
  detectSlowDaysForTenant,
  formatSlowDayAlert,
  slowDayAlertLines,
  toDayAggregates,
  toDayKey,
  totalSlowDays,
  DAY_NAMES,
  HISTORY_DAYS,
  WEEK_DAYS,
  type ReservationLike,
  type SlowDayInsight,
  type SlowDayReport,
  type SlowDayStore,
} from './slow-days.ts';

/**
 * A Monday at 07:00 — the same moment the daily brief cron runs. Mondays
 * are the interesting case: a "calendar week to date" definition would
 * have no completed day to judge at all, which is exactly why the window
 * is the last 7 complete days.
 */
const NOW = new Date('2026-08-24T07:00:00.000Z');
const WINDOW = computeSlowDayWindow(NOW);
const TENANT = 'tenant-bistro';

/** Baseline demand used by the seeders: 15 bookings on every weekday. */
const BASELINE = 15;

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

/** The 'YYYY-MM-DD' of the given weekday inside the window under test. */
function dayInWindow(dayName: string): string {
  for (let i = 0; i < WEEK_DAYS; i += 1) {
    const date = addDays(WINDOW.weekStart, i);
    if (DAY_NAMES[date.getUTCDay()] === dayName) return toDayKey(date)!;
  }
  throw new Error(`${dayName} is not in the window under test`);
}

/**
 * Seed `historyDays` + the current week of reservations.
 *
 * `bookingsFor` decides how many bookings land on a given calendar day,
 * which is how a dip is introduced; `partySizeFor` varies the guest count
 * so the per-weekday party-size averages can be asserted.
 */
function seedReservations(options: {
  tenantId?: string;
  now?: Date;
  historyDays?: number;
  weekDays?: number;
  bookingsFor: (dayKey: string, date: Date) => number;
  partySizeFor?: (dayKey: string, date: Date) => number;
  cancelledOn?: (dayKey: string, date: Date) => number;
}): ReservationLike[] {
  const now = options.now ?? NOW;
  const historyDays = options.historyDays ?? HISTORY_DAYS;
  const weekDays = options.weekDays ?? WEEK_DAYS;
  const window = computeSlowDayWindow(now, { historyDays, weekDays });
  const rows: ReservationLike[] = [];

  const totalDays = historyDays + weekDays;
  for (let i = 0; i < totalDays; i += 1) {
    const day = addDays(window.historyStart, i);
    const key = toDayKey(day)!;

    for (let b = 0; b < options.bookingsFor(key, day); b += 1) {
      rows.push({
        tenantId: options.tenantId ?? TENANT,
        // Dinner service, spread across the evening so the day key comes
        // from a realistic timestamp rather than midnight.
        date: new Date(`${key}T${String(17 + (b % 5)).padStart(2, '0')}:${String((b * 7) % 60).padStart(2, '0')}:00.000Z`),
        partySize: options.partySizeFor?.(key, day) ?? 4,
        status: 'confirmed',
      });
    }

    for (let c = 0; c < (options.cancelledOn?.(key, day) ?? 0); c += 1) {
      rows.push({
        tenantId: options.tenantId ?? TENANT,
        date: new Date(`${key}T20:15:00.000Z`),
        partySize: 2,
        status: 'cancelled',
      });
    }
  }

  return rows;
}

/**
 * 90 days of history at a flat 15 bookings a day, with this week's
 * Tuesday down to 8 and this week's Wednesday down to 4.
 */
function seededReport(): SlowDayReport {
  const tuesday = dayInWindow('Tuesday');
  const wednesday = dayInWindow('Wednesday');

  return analyzeSlowDays(
    seedReservations({
      bookingsFor: (key) => {
        if (key === tuesday) return 8;
        if (key === wednesday) return 4;
        return BASELINE;
      },
    }),
    { now: NOW }
  );
}

function findByDay(insights: SlowDayInsight[], day: string): SlowDayInsight {
  const found = insights.find((insight) => insight.day === day);
  assert.ok(found, `no insight for ${day}`);
  return found;
}

describe('slow-day window math', () => {
  test('the current week is the last 7 complete days, ending yesterday', () => {
    assert.equal(WINDOW.weekStart.toISOString(), '2026-08-17T00:00:00.000Z'); // Monday
    assert.equal(WINDOW.weekEnd.toISOString(), '2026-08-24T00:00:00.000Z'); // midnight today, exclusive
    assert.equal(WINDOW.historyStart.toISOString(), '2026-05-19T00:00:00.000Z');
    assert.equal(WINDOW.historyEnd.toISOString(), WINDOW.weekStart.toISOString());
  });

  test('the window contains each weekday exactly once, and 90 days of history', () => {
    const weekdays = new Set<number>();
    for (let i = 0; i < WEEK_DAYS; i += 1) weekdays.add(addDays(WINDOW.weekStart, i).getUTCDay());
    assert.equal(weekdays.size, 7);

    let days = 0;
    for (let cursor = WINDOW.historyStart.getTime(); cursor < WINDOW.historyEnd.getTime(); cursor += 24 * 60 * 60 * 1000) {
      days += 1;
    }
    assert.equal(days, HISTORY_DAYS);
  });
});

describe('slow-day detection: history vs current week', () => {
  test('flags a day below 60% of its historical average', () => {
    const tuesday = findByDay(seededReport().slowDays, 'Tuesday');

    // The shape the revenue dashboard renders.
    assert.equal(tuesday.day, 'Tuesday');
    assert.equal(tuesday.currentBookings, 8);
    assert.equal(tuesday.historicalAvg, 15);
    assert.equal(tuesday.occupancy, '53%');
    assert.deepEqual(tuesday.flags, ['slow']);
    assert.equal(tuesday.recommendation, 'Launch Tuesday special campaign');
  });

  test('leaves normal days unflagged', () => {
    const report = seededReport();
    const saturday = findByDay(report.days, 'Saturday');

    assert.equal(saturday.currentBookings, BASELINE);
    assert.equal(saturday.occupancy, '100%');
    assert.deepEqual(saturday.flags, []);
    assert.match(saturday.recommendation, /^No action needed/);
    assert.ok(!report.slowDays.some((day) => day.day === 'Saturday'));
  });

  test('exactly 60% of the average is not a slow day (the threshold is strict)', () => {
    const thursday = dayInWindow('Thursday');
    const report = analyzeSlowDays(
      seedReservations({ bookingsFor: (key) => (key === thursday ? 9 : BASELINE) }),
      { now: NOW }
    );

    const insight = findByDay(report.days, 'Thursday');
    assert.equal(insight.currentBookings, 9);
    assert.equal(insight.occupancy, '60%');
    assert.deepEqual(insight.flags, []);
  });

  test('below 50% is flagged slow and critical', () => {
    const report = seededReport();
    const wednesday = findByDay(report.slowDays, 'Wednesday');

    assert.equal(wednesday.currentBookings, 4);
    assert.equal(wednesday.occupancy, '27%');
    assert.deepEqual(wednesday.flags, ['slow', 'critical']);
    assert.match(wednesday.recommendation, /^Launch Wednesday special campaign now/);
    assert.deepEqual(report.criticalSlowDays.map((day) => day.day), ['Wednesday']);
  });

  test("this week's dip does not dilute the baseline it is measured against", () => {
    assert.equal(findByDay(seededReport().days, 'Tuesday').historicalAvg, 15);

    const historyOnly = analyzeSlowDays(seedReservations({ bookingsFor: () => BASELINE }), { now: NOW });
    assert.equal(findByDay(historyOnly.days, 'Tuesday').historicalAvg, 15);
  });

  test('ignores cancelled reservations', () => {
    const friday = dayInWindow('Friday');
    const report = analyzeSlowDays(
      seedReservations({
        // 6 confirmed + 9 cancelled = 15 rows, but only 6 count as demand.
        bookingsFor: (key) => (key === friday ? 6 : BASELINE),
        cancelledOn: (key) => (key === friday ? 9 : 0),
      }),
      { now: NOW }
    );

    const insight = findByDay(report.days, 'Friday');
    assert.equal(insight.currentBookings, 6);
    assert.equal(insight.historicalAvg, 15);
    assert.equal(insight.occupancy, '40%');
    assert.deepEqual(insight.flags, ['slow', 'critical']);
  });

  test('counts cancelled reservations when explicitly asked to', () => {
    const friday = dayInWindow('Friday');
    const rows = seedReservations({
      bookingsFor: (key) => (key === friday ? 6 : BASELINE),
      cancelledOn: (key) => (key === friday ? 9 : 0),
    });

    const insight = findByDay(analyzeSlowDays(rows, { now: NOW, includeCancelled: true }).days, 'Friday');
    assert.equal(insight.currentBookings, 15);
    assert.deepEqual(insight.flags, []);
  });

  test('does not flag a weekday whose history is too thin to judge', () => {
    // A brand-new tenant: one booking ever, and nothing this week.
    const rows: ReservationLike[] = [
      { tenantId: TENANT, date: new Date(`${dayInWindow('Tuesday')}T19:00:00.000Z`), partySize: 2, status: 'confirmed' },
    ];
    const report = analyzeSlowDays(rows, { now: NOW });

    assert.deepEqual(report.slowDays, []);
    const tuesday = findByDay(report.days, 'Tuesday');
    assert.equal(tuesday.historicalAvg, 0);
    assert.equal(tuesday.recommendation, 'Not enough Tuesday history to recommend a campaign yet');
  });

  test('judges 7 complete days and never the day in progress', () => {
    const report = seededReport();

    assert.equal(report.days.length, 7);
    assert.equal(report.days[0].date, '2026-08-17');
    assert.equal(report.days[6].date, '2026-08-23');
    assert.ok(!report.days.some((day) => day.date === '2026-08-24'), 'today must not be judged');
    assert.deepEqual(
      report.days.map((day) => day.day),
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    );
  });

  test('reports party size per weekday, historically and now', () => {
    const tuesday = dayInWindow('Tuesday');
    const report = analyzeSlowDays(
      seedReservations({
        bookingsFor: (key) => (key === tuesday ? 8 : BASELINE),
        // Tables of 6 on historical Tuesdays, but only couples this week.
        partySizeFor: (key) => (key === tuesday ? 2 : 6),
      }),
      { now: NOW }
    );

    const insight = findByDay(report.days, 'Tuesday');
    assert.equal(insight.currentAvgPartySize, 2);
    assert.equal(insight.historicalAvgPartySize, 6);
    assert.equal(insight.currentGuests, 16);
    assert.equal(insight.historicalAvgGuests, 90);
  });

  test('exposes the comparison window so the dashboard can show its basis', () => {
    const report = seededReport();
    assert.deepEqual(report.window, {
      weekStart: '2026-08-17T00:00:00.000Z',
      weekEnd: '2026-08-24T00:00:00.000Z',
      historyStart: '2026-05-19T00:00:00.000Z',
      historyEnd: '2026-08-17T00:00:00.000Z',
    });
  });

  test('skips rows with an unparseable date instead of throwing', () => {
    const report = analyzeSlowDays(
      [...seedReservations({ bookingsFor: () => BASELINE }), { tenantId: TENANT, date: 'not-a-date', partySize: 4 }],
      { now: NOW }
    );

    assert.equal(report.days.length, 7);
    assert.deepEqual(report.slowDays, []);
  });

  test('a healthy week produces no slow days at all', () => {
    const report = analyzeSlowDays(seedReservations({ bookingsFor: () => BASELINE }), { now: NOW });

    assert.deepEqual(report.slowDays, []);
    assert.deepEqual(report.criticalSlowDays, []);
    assert.equal(report.days.length, 7);
  });
});

describe('slow-day aggregation', () => {
  test('folds rows into per-day bookings and guests', () => {
    const aggregates = toDayAggregates([
      { date: new Date('2026-08-18T18:00:00.000Z'), partySize: 4, status: 'confirmed' },
      { date: new Date('2026-08-18T20:30:00.000Z'), partySize: 2, status: 'completed' },
      { date: new Date('2026-08-18T21:00:00.000Z'), partySize: 6, status: 'cancelled' },
    ]);

    assert.deepEqual(aggregates, [{ day: '2026-08-18', bookings: 2, guests: 6 }]);
  });

  test('accepts pre-grouped aggregates (the super-admin path)', () => {
    const tuesday = dayInWindow('Tuesday');
    const aggregates: Array<{ day: string; bookings: number; guests: number }> = [];
    for (let i = 0; i < HISTORY_DAYS + WEEK_DAYS; i += 1) {
      const key = toDayKey(addDays(WINDOW.historyStart, i))!;
      aggregates.push({ day: key, bookings: key === tuesday ? 8 : BASELINE, guests: 60 });
    }

    const report = analyzeDayAggregates(aggregates, { now: NOW });

    assert.deepEqual(report.slowDays.map((day) => day.day), ['Tuesday']);
    assert.equal(findByDay(report.days, 'Tuesday').occupancy, '53%');
  });
});

describe('daily brief alert copy', () => {
  test('formats the alert line an owner sees', () => {
    assert.equal(
      formatSlowDayAlert(findByDay(seededReport().days, 'Tuesday')),
      '⚠️ Slow day alert: Tuesday has only 8 bookings (53% of average). Consider a campaign.'
    );
  });

  test('pluralises a single booking', () => {
    const solo: SlowDayInsight = { ...findByDay(seededReport().days, 'Tuesday'), currentBookings: 1 };
    assert.match(formatSlowDayAlert(solo), /has only 1 booking \(53% of average\)/);
  });

  test('only escalates days below the 50% critical threshold', () => {
    const report = seededReport();
    // Tuesday is 53% (slow but not critical), Wednesday is 27%.
    assert.deepEqual(slowDayAlertLines(report.slowDays), [
      '⚠️ Slow day alert: Wednesday has only 4 bookings (27% of average). Consider a campaign.',
    ]);
    assert.deepEqual(slowDayAlertLines(report.criticalSlowDays), slowDayAlertLines(report.slowDays));
  });

  test('stays silent when the week is healthy', () => {
    const report = analyzeSlowDays(seedReservations({ bookingsFor: () => BASELINE }), { now: NOW });
    assert.deepEqual(slowDayAlertLines(report.slowDays), []);
  });
});

describe('slow-day detection through the store boundary (integration)', () => {
  /**
   * An in-memory stand-in for the `reservations` table. It is seeded with
   * 90 days of history plus the current week and only returns rows inside
   * the requested window — so a wrong window in the analytics shows up as
   * missing data instead of silently passing.
   */
  function fakeStore(rows: ReservationLike[]): {
    store: SlowDayStore;
    calls: Array<{ tenantId: string; start: Date; end: Date }>;
  } {
    const calls: Array<{ tenantId: string; start: Date; end: Date }> = [];
    return {
      calls,
      store: {
        async findReservations({ tenantId, start, end }) {
          calls.push({ tenantId, start, end });
          return rows.filter((row) => {
            const at = new Date(row.date as string).getTime();
            return row.tenantId === tenantId && at >= start.getTime() && at < end.getTime();
          });
        },
      },
    };
  }

  test('detects the Tuesday dip end-to-end from 90 days of seeded reservations', async () => {
    const tuesday = dayInWindow('Tuesday');
    const wednesday = dayInWindow('Wednesday');

    const rows = seedReservations({
      bookingsFor: (key) => {
        if (key === tuesday) return 8;
        if (key === wednesday) return 4;
        return BASELINE;
      },
    });
    // Another tenant's bookings must never leak into this report.
    rows.push(...seedReservations({ tenantId: 'tenant-other', bookingsFor: () => 40 }));

    const { store, calls } = fakeStore(rows);
    const report = await detectSlowDaysForTenant(store, TENANT, { now: NOW });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].tenantId, TENANT);
    assert.equal(calls[0].start.toISOString(), '2026-05-19T00:00:00.000Z');
    assert.equal(calls[0].end.toISOString(), '2026-08-24T00:00:00.000Z');

    assert.deepEqual(report.slowDays.map((day) => day.day), ['Tuesday', 'Wednesday']);

    const tuesdayInsight = findByDay(report.slowDays, 'Tuesday');
    assert.equal(tuesdayInsight.currentBookings, 8);
    assert.equal(tuesdayInsight.historicalAvg, 15);
    assert.equal(tuesdayInsight.occupancy, '53%');
    assert.deepEqual(tuesdayInsight.flags, ['slow']);
    assert.equal(tuesdayInsight.recommendation, 'Launch Tuesday special campaign');
  });

  test('the payload serialises to the documented JSON shape', async () => {
    const tuesday = dayInWindow('Tuesday');
    const { store } = fakeStore(seedReservations({ bookingsFor: (key) => (key === tuesday ? 8 : BASELINE) }));

    const report = await detectSlowDaysForTenant(store, TENANT, { now: NOW });
    const [slowDay] = JSON.parse(JSON.stringify(report.slowDays)) as Array<Record<string, unknown>>;

    assert.deepEqual(
      {
        day: slowDay.day,
        currentBookings: slowDay.currentBookings,
        historicalAvg: slowDay.historicalAvg,
        occupancy: slowDay.occupancy,
        flags: slowDay.flags,
        recommendation: slowDay.recommendation,
      },
      {
        day: 'Tuesday',
        currentBookings: 8,
        historicalAvg: 15,
        occupancy: '53%',
        flags: ['slow'],
        recommendation: 'Launch Tuesday special campaign',
      }
    );
  });

  test('a realistic 90-day pattern still isolates the quiet weekday', async () => {
    // Deterministic pseudo-random demand of 10-20 bookings a day (weekends
    // busier), with this week's Sunday halved by a competitor's promo.
    // Detection must pick Sunday out of the noise, and nothing else.
    const sunday = dayInWindow('Sunday');
    // 31-bit LCG. Math.imul keeps the multiply inside 32 bits — a plain
    // `seed * 1103515245` exceeds Number.MAX_SAFE_INTEGER and silently
    // produces a degenerate sequence.
    let seed = 42;
    const nextRandom = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const rows = seedReservations({
      bookingsFor: (key, date) => {
        const dow = date.getUTCDay();
        const weekendBoost = dow === 0 || dow === 5 || dow === 6 ? 6 : 0;
        // Weekdays land in 14-18, weekend days in 20-24: noisy, but never
        // so spread out that an ordinary weekday looks like a slow day.
        const base = 14 + Math.floor(nextRandom() * 5) + weekendBoost;
        return key === sunday ? Math.floor(base * 0.4) : base;
      },
    });

    const report = await detectSlowDaysForTenant(fakeStore(rows).store, TENANT, { now: NOW });

    assert.deepEqual(report.slowDays.map((day) => day.day), ['Sunday']);
    const sundayInsight = findByDay(report.slowDays, 'Sunday');
    assert.ok(sundayInsight.historicalAvg >= 20, `expected a busy historical Sunday, got ${sundayInsight.historicalAvg}`);
    assert.ok(sundayInsight.occupancyRatio < 0.5, `expected Sunday below the critical threshold, got ${sundayInsight.occupancy}`);
    assert.deepEqual(sundayInsight.flags, ['slow', 'critical']);
  });

  test('counts slow days across several tenants for the super-admin metric', async () => {
    const tuesday = dayInWindow('Tuesday');
    const wednesday = dayInWindow('Wednesday');

    const [tenantA, tenantB, tenantC] = await Promise.all([
      detectSlowDaysForTenant(
        fakeStore(seedReservations({ tenantId: 'tenant-a', bookingsFor: (key) => (key === tuesday ? 5 : BASELINE) })).store,
        'tenant-a',
        { now: NOW }
      ),
      detectSlowDaysForTenant(
        fakeStore(
          seedReservations({
            tenantId: 'tenant-b',
            bookingsFor: (key) => (key === tuesday || key === wednesday ? 3 : BASELINE),
          })
        ).store,
        'tenant-b',
        { now: NOW }
      ),
      detectSlowDaysForTenant(
        fakeStore(seedReservations({ tenantId: 'tenant-c', bookingsFor: () => BASELINE })).store,
        'tenant-c',
        { now: NOW }
      ),
    ]);

    assert.deepEqual(tenantA.slowDays.map((day) => day.day), ['Tuesday']);
    assert.deepEqual(tenantB.slowDays.map((day) => day.day), ['Tuesday', 'Wednesday']);
    assert.deepEqual(tenantC.slowDays, []);
    assert.equal(totalSlowDays([tenantA, tenantB, tenantC]), 3);
  });
});
