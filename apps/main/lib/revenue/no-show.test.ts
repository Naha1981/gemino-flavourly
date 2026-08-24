import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNoShowFollowupMessage,
  computeDetectionCutoff,
  detectionEligibility,
  followupReadiness,
  nextWeekendDate,
  runNoShowCron,
  startOfUtcDay,
  NOSHOW_FOLLOWUP_DELAY_HOURS,
  NOSHOW_GRACE_HOURS,
  type NoShowStore,
} from './no-show.ts';

/** Monday 07:00 — a typical morning run of the every-30-minutes cron. */
const NOW = new Date('2026-08-24T07:00:00.000Z');
/** The table the customer never arrived for: Sunday dinner. */
const BOOKED_FOR = new Date('2026-08-23T19:00:00.000Z');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MINUTE = 60 * 1000;

const hours = (n: number) => n * HOUR;
const hoursAgo = (n: number, from: Date = NOW) => new Date(from.getTime() - hours(n));

/** A row in the fake `reservations` table. */
interface FakeRow {
  id: string;
  tenantId: string;
  customerName: string | null;
  customerPhone: string | null;
  contactId: string | null;
  conversationId: string | null;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  reservationDate: Date;
  partySize: number;
  noShowDetected: boolean;
  noShowDetectedAt: Date | null;
  noShowFollowupSent: boolean;
  noShowFollowupSentAt: Date | null;
}

interface QueuedJob {
  tenantId: string;
  waAccountId: string;
  to: string;
  text: string;
}

function fakeRow(partial: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'reservation-1',
    tenantId: 'tenant-bistro',
    customerName: 'Thabo',
    customerPhone: '+27820000000',
    contactId: 'contact-1',
    conversationId: 'conversation-1',
    status: 'confirmed',
    reservationDate: BOOKED_FOR,
    partySize: 4,
    noShowDetected: false,
    noShowDetectedAt: null,
    noShowFollowupSent: false,
    noShowFollowupSentAt: null,
    ...partial,
  };
}

/**
 * An in-memory stand-in for the reservations table.
 *
 * Both scans deliberately apply NO predicates at all — every row comes
 * back regardless of status, flags or windows, a wider result set than the
 * real query ever returns, so these tests also prove the cron re-validates
 * every predicate per row instead of trusting the query.
 *
 * `accounts` maps tenantId -> that tenant's connected WhatsApp account;
 * `noRecipientFor`, `failQueueFor` and `failMarkFor` simulate the three
 * real failure modes: no route to the customer, the outbox insert
 * throwing, and the detection stamp throwing.
 */
function fakeStore(
  rows: FakeRow[],
  options: { accounts?: Record<string, string>; noRecipientFor?: string[]; failQueueFor?: string[]; failMarkFor?: string[] } = {}
) {
  const jobs: QueuedJob[] = [];
  const detectionQueries: Array<{ cutoff: Date; limit: number }> = [];
  const followupQueries: Array<{ detectedBefore: Date; limit: number }> = [];
  const detections: Array<{ reservationId: string; detectedAt: Date }> = [];
  const sentMarks: Array<{ reservationId: string; sentAt: Date }> = [];
  const recipientLookups: Array<{ reservationId: string; tenantId: string }> = [];

  const store: NoShowStore = {
    async findNoShowCandidates({ cutoff, limit }) {
      detectionQueries.push({ cutoff, limit });
      return rows.slice(0, limit).map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        contactId: row.contactId,
        conversationId: row.conversationId,
        status: row.status,
        reservationDate: row.reservationDate,
        partySize: row.partySize,
        noShowDetected: row.noShowDetected,
      }));
    },

    async markNoShowDetected(reservationId, detectedAt) {
      if (options.failMarkFor?.includes(reservationId)) throw new Error('update failed');
      const row = rows.find((r) => r.id === reservationId);
      if (!row) throw new Error(`unknown reservation ${reservationId}`);
      row.noShowDetected = true;
      row.noShowDetectedAt = detectedAt;
      detections.push({ reservationId, detectedAt });
    },

    async findDueFollowups({ detectedBefore, limit }) {
      followupQueries.push({ detectedBefore, limit });
      return rows.slice(0, limit).map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        contactId: row.contactId,
        conversationId: row.conversationId,
        status: row.status,
        reservationDate: row.reservationDate,
        partySize: row.partySize,
        noShowDetected: row.noShowDetected,
        noShowDetectedAt: row.noShowDetectedAt,
        noShowFollowupSent: row.noShowFollowupSent,
      }));
    },

    async findRecipient(candidate) {
      recipientLookups.push({ reservationId: candidate.id, tenantId: candidate.tenantId });
      if (options.noRecipientFor?.includes(candidate.id)) return null;
      const accounts = options.accounts ?? { 'tenant-bistro': 'wa-account-1' };
      const waAccountId = accounts[candidate.tenantId] ?? null;
      if (!waAccountId) return null;
      return { to: candidate.customerPhone ?? '+27000000000', waAccountId, name: candidate.customerName };
    },

    async queueFollowup(input) {
      if (options.failQueueFor?.some((id) => input.text.includes(id))) throw new Error('outbox insert failed');
      jobs.push(input);
    },

    async markFollowupSent(reservationId, sentAt) {
      const row = rows.find((r) => r.id === reservationId);
      if (!row) throw new Error(`unknown reservation ${reservationId}`);
      row.noShowFollowupSent = true;
      row.noShowFollowupSentAt = sentAt;
      sentMarks.push({ reservationId, sentAt });
    },
  };

  return { store, jobs, rows, detectionQueries, followupQueries, detections, sentMarks, recipientLookups };
}

describe('no-show detection cutoff', () => {
  test('grace and follow-up delay are both 2 hours', () => {
    assert.equal(NOSHOW_GRACE_HOURS, 2);
    assert.equal(NOSHOW_FOLLOWUP_DELAY_HOURS, 2);
  });

  test('after 02:00 the cutoff is now − 2h', () => {
    assert.equal(computeDetectionCutoff(NOW).toISOString(), '2026-08-24T05:00:00.000Z');
    assert.equal(
      computeDetectionCutoff(new Date('2026-08-24T21:30:00.000Z')).toISOString(),
      '2026-08-24T19:30:00.000Z'
    );
  });

  test('between 00:00 and 02:00 the cutoff is start-of-today', () => {
    assert.equal(
      computeDetectionCutoff(new Date('2026-08-24T00:30:00.000Z')).toISOString(),
      '2026-08-24T00:00:00.000Z'
    );
    assert.equal(
      computeDetectionCutoff(new Date('2026-08-24T01:59:00.000Z')).toISOString(),
      '2026-08-24T00:00:00.000Z'
    );
    assert.equal(
      computeDetectionCutoff(new Date('2026-08-24T02:00:00.000Z')).toISOString(),
      '2026-08-24T00:00:00.000Z'
    );
    // 02:01 is the first minute the grace window leads the day rollover.
    assert.equal(
      computeDetectionCutoff(new Date('2026-08-24T02:01:00.000Z')).toISOString(),
      '2026-08-24T00:01:00.000Z'
    );
  });

  test('the 23:30-booked → 00:30-checked edge is caught at the day rollover', () => {
    const bookedFor = new Date('2026-08-23T23:30:00.000Z');
    const checkedAt = new Date('2026-08-24T00:30:00.000Z');

    const cutoff = computeDetectionCutoff(checkedAt);
    assert.equal(cutoff.toISOString(), '2026-08-24T00:00:00.000Z');
    assert.ok(bookedFor.getTime() < cutoff.getTime(), 'the 23:30 booking must be detectable at 00:30');

    // Without the start-of-today arm the cutoff would be now − 2h =
    // yesterday 22:30, and the 23:30 booking would sit undetected until
    // 01:30 — 1.5 hours late.
    const naiveGraceOnly = new Date(checkedAt.getTime() - hours(2));
    assert.ok(bookedFor.getTime() > naiveGraceOnly.getTime(), 'a grace-only cutoff would miss this edge');
  });

  test('the max() cutoff is exactly the spec disjunction across a 97-hour sweep', () => {
    // The gate specifies the scan as
    //   date < today OR (date = today AND time < now − 2h)
    // and the implementation as date < max(startOfToday, now − 2h). For
    // every minute of a 97-hour sweep (4+ day rollovers, covering the
    // 00:00–02:00 window where the two formulations look most different),
    // probe a dense grid of reservation times around both boundaries and
    // require identical answers.
    const literalSpec = (reservationAt: Date, now: Date): boolean => {
      const dayStart = startOfUtcDay(now);
      const grace = new Date(now.getTime() - hours(NOSHOW_GRACE_HOURS));
      if (reservationAt.getTime() < dayStart.getTime()) return true; // date < today
      const sameDay = reservationAt.getTime() < dayStart.getTime() + DAY; // date = today
      return sameDay && reservationAt.getTime() < grace.getTime(); // time < now − 2h
    };

    const base = new Date('2026-08-24T00:00:00.000Z'); // Monday 00:00 UTC
    let checks = 0;
    for (let m = 0; m <= 97 * 60; m += 7) {
      const now = new Date(base.getTime() + m * MINUTE);
      const cutoff = computeDetectionCutoff(now);
      const dayStart = startOfUtcDay(now);
      const grace = new Date(now.getTime() - hours(NOSHOW_GRACE_HOURS));

      // Around the day boundary, around the grace boundary, far past, far future.
      const probes = [-1440, -180, -59, -1, 0, 1, 59, 121, 1439, 1440].map(
        (off) => new Date(dayStart.getTime() + off * MINUTE)
      );
      probes.push(
        new Date(grace.getTime() - MINUTE),
        grace,
        new Date(grace.getTime() + MINUTE),
        now,
        new Date(dayStart.getTime() + hours(23.5))
      );

      for (const reservationAt of probes) {
        assert.equal(
          reservationAt.getTime() < cutoff.getTime(),
          literalSpec(reservationAt, now),
          `mismatch at now=${now.toISOString()} booking=${reservationAt.toISOString()}`
        );
        checks += 1;
      }
    }
    assert.ok(checks > 10_000, `the sweep should be dense; only made ${checks} comparisons`);
  });

  test('a custom grace period shifts the cutoff', () => {
    assert.equal(
      computeDetectionCutoff(NOW, { graceHours: 4 }).toISOString(),
      '2026-08-24T03:00:00.000Z'
    );
  });
});

describe('detection eligibility (re-validation)', () => {
  test('a confirmed booking past the cutoff is detectable', () => {
    assert.equal(
      detectionEligibility({ status: 'confirmed', noShowDetected: false, reservationDate: BOOKED_FOR }, { now: NOW }),
      'detect'
    );
  });

  test('anything other than confirmed is not the cron’s to flag', () => {
    for (const status of ['completed', 'cancelled', 'no_show']) {
      assert.equal(
        detectionEligibility({ status, noShowDetected: false, reservationDate: BOOKED_FOR }, { now: NOW }),
        'not_confirmed',
        `${status} must not be flagged`
      );
    }
  });

  test('an already-flagged booking is never flagged twice', () => {
    assert.equal(
      detectionEligibility({ status: 'confirmed', noShowDetected: true, reservationDate: BOOKED_FOR }, { now: NOW }),
      'already_detected'
    );
  });

  test('the grace window is strict: exactly at the cutoff is too early', () => {
    const cutoff = computeDetectionCutoff(NOW);
    assert.equal(
      detectionEligibility({ status: 'confirmed', noShowDetected: false, reservationDate: cutoff }, { now: NOW }),
      'too_early'
    );
    assert.equal(
      detectionEligibility(
        { status: 'confirmed', noShowDetected: false, reservationDate: new Date(cutoff.getTime() - 1) },
        { now: NOW }
      ),
      'detect'
    );
  });

  test('a booking still inside its grace period is too early', () => {
    const grace = new Date(NOW.getTime() - hours(2));
    const inside = new Date(grace.getTime() + hours(1)); // 1h ago
    assert.equal(
      detectionEligibility({ status: 'confirmed', noShowDetected: false, reservationDate: inside }, { now: NOW }),
      'too_early'
    );
  });
});

describe('follow-up readiness (re-validation)', () => {
  const detected3hAgo = {
    status: 'confirmed',
    noShowDetectedAt: hoursAgo(3),
    noShowFollowupSent: false,
  };

  test('detected more than 2h ago → due', () => {
    assert.equal(followupReadiness(detected3hAgo, { now: NOW }), 'due');
    assert.equal(
      followupReadiness({ ...detected3hAgo, noShowDetectedAt: hoursAgo(2.01) }, { now: NOW }),
      'due'
    );
  });

  test('detected 2h ago or less → not yet due (the bound is strict)', () => {
    for (const h of [0, 0.5, 1, 1.99, 2]) {
      assert.equal(
        followupReadiness({ ...detected3hAgo, noShowDetectedAt: hoursAgo(h) }, { now: NOW }),
        'not_yet_due',
        `detected ${h}h ago must not be due`
      );
    }
  });

  test('a booking staff completed during the gap is never messaged', () => {
    assert.equal(followupReadiness({ ...detected3hAgo, status: 'completed' }, { now: NOW }), 'not_confirmed');
    assert.equal(followupReadiness({ ...detected3hAgo, status: 'cancelled' }, { now: NOW }), 'not_confirmed');
    assert.equal(followupReadiness({ ...detected3hAgo, status: 'no_show' }, { now: NOW }), 'not_confirmed');
  });

  test('an already-sent follow-up is never sent twice', () => {
    assert.equal(
      followupReadiness({ ...detected3hAgo, noShowFollowupSent: true }, { now: NOW }),
      'already_sent'
    );
  });

  test('a booking that was never detected has no follow-up', () => {
    assert.equal(followupReadiness({ ...detected3hAgo, noShowDetectedAt: null }, { now: NOW }), 'never_detected');
  });
});

describe('no-show follow-up message', () => {
  test('offers the upcoming Saturday (the big night)', () => {
    assert.equal(
      buildNoShowFollowupMessage({ customerName: 'Thabo', now: NOW }),
      'Hi Thabo, we missed you tonight! We still have tables available this Saturday. Would you like to rebook?'
    );
  });

  test('falls back to "there" when there is no name', () => {
    for (const name of [null, undefined, '', '   ']) {
      const text = buildNoShowFollowupMessage({ customerName: name, now: NOW });
      assert.match(text, /^Hi there, we missed you tonight!/);
    }
  });

  test('the offered Saturday is always 1–7 days out, never in the past', () => {
    // Monday → this Saturday (+5)
    assert.equal(nextWeekendDate(NOW).toISOString().slice(0, 10), '2026-08-29');
    // Friday lunch → tomorrow (+1)
    assert.equal(nextWeekendDate(new Date('2026-08-28T12:00:00.000Z')).toISOString().slice(0, 10), '2026-08-29');
    // Saturday night (tonight’s Saturday already missed) → next week (+7)
    assert.equal(nextWeekendDate(new Date('2026-08-29T21:00:00.000Z')).toISOString().slice(0, 10), '2026-09-05');
    // Sunday morning → +6
    assert.equal(nextWeekendDate(new Date('2026-08-30T08:00:00.000Z')).toISOString().slice(0, 10), '2026-09-05');

    for (let d = 0; d < 14; d += 1) {
      const someDay = new Date(NOW.getTime() + d * DAY);
      const offered = nextWeekendDate(someDay);
      const dayKey = (v: Date) => Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
      const daysOut = (dayKey(offered) - dayKey(someDay)) / DAY;
      assert.ok(daysOut >= 1 && daysOut <= 7, `from ${someDay.toISOString()} the offer is ${daysOut} days out`);
      assert.equal(offered.getUTCDay(), 6, 'the offer is always a Saturday');
    }
  });
});

describe('no-show cron, phase 1 (detection)', () => {
  test('flags only the due no-show and stamps it with the run time', async () => {
    const rows = [
      fakeRow({ id: 'r-due', reservationDate: BOOKED_FOR }),
      fakeRow({ id: 'r-fresh', reservationDate: new Date(NOW.getTime() - hours(0.5)) }), // 30 min ago
      fakeRow({ id: 'r-completed', status: 'completed', reservationDate: BOOKED_FOR }),
      fakeRow({ id: 'r-flagged', noShowDetected: true, noShowDetectedAt: hoursAgo(5), reservationDate: BOOKED_FOR }),
    ];
    const { store, detectionQueries } = fakeStore(rows); // note: r-flagged has detectedAt, ready for phase 2

    const summary = await runNoShowCron(store, { now: NOW });

    assert.equal(summary.detection.scanned, 4);
    assert.equal(summary.detection.detected, 1);
    assert.deepEqual(summary.detection.skipped, { notConfirmed: 1, alreadyDetected: 1, tooEarly: 1, failed: 0 });

    assert.equal(rows[0].noShowDetected, true);
    assert.equal(rows[0].noShowDetectedAt?.toISOString(), NOW.toISOString());
    assert.deepEqual(
      rows.slice(1).map((row) => row.noShowDetectedAt?.toISOString() ?? null),
      [null, null, hoursAgo(5).toISOString()]
    );

    // The query is handed the computed cutoff (05:00 for a 07:00 run).
    assert.equal(detectionQueries.length, 1);
    assert.equal(detectionQueries[0].cutoff.toISOString(), '2026-08-24T05:00:00.000Z');

    assert.deepEqual(summary.detection.samples, [
      { reservationId: 'r-due', tenantId: 'tenant-bistro', reservationDate: BOOKED_FOR.toISOString() },
    ]);
  });

  test('a stamping failure aborts neither the batch nor the follow-up phase', async () => {
    const rows = [
      fakeRow({ id: 'r-boom', reservationDate: BOOKED_FOR }),
      fakeRow({ id: 'r-fine', reservationDate: BOOKED_FOR }),
      fakeRow({ id: 'r-ready', noShowDetected: true, noShowDetectedAt: hoursAgo(3), customerName: 'Amahle' }),
    ];
    const { store, jobs } = fakeStore(rows, { failMarkFor: ['r-boom'] });

    const summary = await runNoShowCron(store, { now: NOW });

    assert.equal(summary.detection.detected, 1);
    assert.equal(summary.detection.skipped.failed, 1);
    assert.equal(rows[0].noShowDetected, false); // failed stamp → retried next run
    assert.equal(rows[1].noShowDetected, true);
    // Phase 2 still ran and messaged the long-detected row.
    assert.equal(summary.followup.sent, 1);
    assert.equal(jobs.length, 1);
    assert.match(jobs[0].text, /^Hi Amahle,/);
  });
});

describe('no-show cron, phase 2 (follow-up)', () => {
  test('sends the rebooking offer once the 2-hour delay has elapsed', async () => {
    const rows = [
      fakeRow({ id: 'r-due-1', noShowDetected: true, noShowDetectedAt: hoursAgo(3), customerName: 'Thabo' }),
      fakeRow({ id: 'r-due-2', noShowDetected: true, noShowDetectedAt: hoursAgo(2.5), customerName: 'Amahle' }),
    ];
    const { store, jobs } = fakeStore(rows);

    const summary = await runNoShowCron(store, { now: NOW });

    assert.equal(summary.followup.scanned, 2);
    assert.equal(summary.followup.sent, 2);
    assert.deepEqual(jobs, [
      {
        tenantId: 'tenant-bistro',
        waAccountId: 'wa-account-1',
        to: '+27820000000',
        text: 'Hi Thabo, we missed you tonight! We still have tables available this Saturday. Would you like to rebook?',
      },
      {
        tenantId: 'tenant-bistro',
        waAccountId: 'wa-account-1',
        to: '+27820000000',
        text: 'Hi Amahle, we missed you tonight! We still have tables available this Saturday. Would you like to rebook?',
      },
    ]);
    assert.deepEqual(rows.map((row) => row.noShowFollowupSent), [true, true]);
    assert.deepEqual(rows.map((row) => row.noShowFollowupSentAt?.toISOString()), [
      NOW.toISOString(),
      NOW.toISOString(),
    ]);
  });

  test('asks the follow-up query for the right delay window and limit', async () => {
    const { store, followupQueries } = fakeStore([]);
    await runNoShowCron(store, { now: NOW, limit: 25 });

    assert.equal(followupQueries.length, 1);
    assert.equal(followupQueries[0].detectedBefore.toISOString(), '2026-08-24T05:00:00.000Z');
    assert.equal(followupQueries[0].limit, 25);
  });

  test('rejects every ineligible row the (deliberately too-wide) query returns', async () => {
    const rows = [
      fakeRow({ id: 'r-soon', noShowDetected: true, noShowDetectedAt: hoursAgo(1) }), // inside the 2h delay
      fakeRow({
        id: 'r-already',
        noShowDetected: true,
        noShowDetectedAt: hoursAgo(5),
        noShowFollowupSent: true,
        noShowFollowupSentAt: hoursAgo(2),
      }),
      // Never detected at all — and booked for tomorrow, so phase 1 of this
      // very run does not flag it first.
      fakeRow({ id: 'r-never', reservationDate: new Date(NOW.getTime() + DAY) }),
      fakeRow({ id: 'r-walked-in', status: 'completed', noShowDetected: true, noShowDetectedAt: hoursAgo(4) }),
      fakeRow({ id: 'r-due', noShowDetected: true, noShowDetectedAt: hoursAgo(6), customerName: 'Sipho' }),
    ];
    const { store, jobs } = fakeStore(rows);

    const summary = await runNoShowCron(store, { now: NOW });

    assert.equal(summary.followup.scanned, 5);
    assert.equal(summary.followup.sent, 1);
    assert.deepEqual(summary.followup.skipped, {
      notConfirmed: 1,
      notYetDue: 1,
      alreadySent: 1,
      neverDetected: 1,
      noRecipient: 0,
      failed: 0,
    });
    assert.equal(jobs.length, 1);
    assert.match(jobs[0].text, /^Hi Sipho,/);
    assert.equal(rows[4].noShowFollowupSent, true);
    assert.deepEqual(
      rows.slice(0, 4).map((row) => row.noShowFollowupSentAt?.toISOString() ?? null),
      [null, hoursAgo(2).toISOString(), null, null]
    );
  });

  test('leaves a reservation unmarked when there is no way to reach the customer', async () => {
    const rows = [fakeRow({ id: 'r-unreachable', noShowDetected: true, noShowDetectedAt: hoursAgo(3) })];
    const { store, jobs } = fakeStore(rows, { noRecipientFor: ['r-unreachable'] });

    const summary = await runNoShowCron(store, { now: NOW });

    assert.equal(summary.followup.sent, 0);
    assert.equal(summary.followup.skipped.noRecipient, 1);
    assert.equal(jobs.length, 0);
    // Not marked: the offer goes out on a later run once WhatsApp reconnects.
    assert.equal(rows[0].noShowFollowupSent, false);
  });

  test('a queue failure does not mark the row sent or abort the batch', async () => {
    const rows = [
      fakeRow({ id: 'r-boom', noShowDetected: true, noShowDetectedAt: hoursAgo(3), customerName: 'r-boom' }),
      fakeRow({ id: 'r-fine', noShowDetected: true, noShowDetectedAt: hoursAgo(4), customerName: 'Sipho' }),
    ];
    const { store, jobs } = fakeStore(rows, { failQueueFor: ['r-boom'] });

    const summary = await runNoShowCron(store, { now: NOW });

    assert.equal(summary.followup.sent, 1);
    assert.equal(summary.followup.skipped.failed, 1);
    assert.deepEqual(rows.map((row) => row.noShowFollowupSent), [false, true]);
    assert.equal(jobs.length, 1);
    assert.match(jobs[0].text, /^Hi Sipho,/);
  });
});

describe('no-show monitoring end to end (mocked clock)', () => {
  test('yesterday’s booking: detect, wait 2h, message exactly once, never again', async () => {
    const row = fakeRow({ id: 'r-e2e', customerName: 'Thabo', reservationDate: BOOKED_FOR });
    const { store, jobs } = fakeStore([row]);

    // Run 1, Monday 07:00 — yesterday’s confirmed booking is detected…
    const run1 = await runNoShowCron(store, { now: NOW });
    assert.equal(run1.detection.detected, 1);
    assert.equal(row.noShowDetectedAt?.toISOString(), NOW.toISOString());
    // …but NOT messaged in the same run: it was detected this very instant,
    // so the 2-hour delay has not elapsed. This is what keeps "we missed
    // you" from arriving while the customer is still finding parking.
    assert.equal(run1.followup.sent, 0);
    assert.equal(run1.followup.skipped.notYetDue, 1);
    assert.equal(jobs.length, 0);

    // Run 2, +1h — detected an hour ago; still inside the delay. Detection
    // does not re-flag the row either.
    const run2 = await runNoShowCron(store, { now: new Date(NOW.getTime() + hours(1)) });
    assert.equal(run2.detection.detected, 0);
    assert.equal(run2.detection.skipped.alreadyDetected, 1);
    assert.equal(run2.followup.sent, 0);
    assert.equal(run2.followup.skipped.notYetDue, 1);
    assert.equal(jobs.length, 0);

    // Run 3, +3h — delay elapsed. The offer goes out exactly once.
    const sentAt = new Date(NOW.getTime() + hours(3));
    const run3 = await runNoShowCron(store, { now: sentAt });
    assert.equal(run3.followup.sent, 1);
    assert.deepEqual(jobs, [
      {
        tenantId: 'tenant-bistro',
        waAccountId: 'wa-account-1',
        to: '+27820000000',
        text: 'Hi Thabo, we missed you tonight! We still have tables available this Saturday. Would you like to rebook?',
      },
    ]);
    assert.equal(row.noShowFollowupSent, true);
    assert.equal(row.noShowFollowupSentAt?.toISOString(), sentAt.toISOString());

    // Run 4, +3.5h — no duplicate, however many runs still scan the row.
    const run4 = await runNoShowCron(store, { now: new Date(NOW.getTime() + hours(3.5)) });
    assert.equal(run4.followup.sent, 0);
    assert.equal(run4.followup.skipped.alreadySent, 1);
    assert.equal(jobs.length, 1);
  });

  test('a customer who walks in during the delay never gets "we missed you"', async () => {
    const row = fakeRow({ id: 'r-late', reservationDate: BOOKED_FOR });
    const { store, jobs } = fakeStore([row]);

    // 07:00 — flagged as a no-show at the grace boundary…
    await runNoShowCron(store, { now: NOW });
    assert.equal(row.noShowDetected, true);

    // …but the customer arrives at 08:00 and staff marks the table complete.
    row.status = 'completed';

    // 10:00 — the follow-up would be due; the status re-check stops it.
    const run = await runNoShowCron(store, { now: new Date(NOW.getTime() + hours(3)) });
    assert.equal(run.followup.sent, 0);
    assert.equal(run.followup.skipped.notConfirmed, 1);
    assert.equal(jobs.length, 0);
  });
});

describe('tenant isolation', () => {
  test('every follow-up is routed through its own tenant and account, never another’s', async () => {
    const rows = [
      fakeRow({ id: 'r-bistro', tenantId: 'tenant-bistro', customerName: 'Thabo', customerPhone: '+27820000001' }),
      fakeRow({ id: 'r-steakhouse', tenantId: 'tenant-steakhouse', customerName: 'Amahle', customerPhone: '+27820000002' }),
    ];
    const { store, jobs, recipientLookups, detections, sentMarks } = fakeStore(rows, {
      accounts: { 'tenant-bistro': 'wa-bistro', 'tenant-steakhouse': 'wa-steakhouse' },
    });

    // Both tenants’ no-shows are detected in the same run…
    const detected = await runNoShowCron(store, { now: NOW });
    assert.equal(detected.detection.detected, 2);
    assert.deepEqual(detections.map((d) => d.reservationId).sort(), ['r-bistro', 'r-steakhouse']);

    // …and messaged 3 hours later in a later run.
    const summary = await runNoShowCron(store, { now: new Date(NOW.getTime() + hours(3)) });
    assert.equal(summary.followup.sent, 2);

    // Every lookup, job and stamp belongs to the reservation’s OWN tenant:
    // the bistro’s offer goes from the bistro’s WhatsApp number to the
    // bistro’s customer, and tenant rows are stamped by id only.
    assert.deepEqual(
      recipientLookups.map((l) => l.tenantId).sort(),
      ['tenant-bistro', 'tenant-steakhouse']
    );
    const byTenant = Object.fromEntries(jobs.map((job) => [job.tenantId, job]));
    assert.equal(byTenant['tenant-bistro'].waAccountId, 'wa-bistro');
    assert.equal(byTenant['tenant-bistro'].to, '+27820000001');
    assert.match(byTenant['tenant-bistro'].text, /^Hi Thabo,/);
    assert.equal(byTenant['tenant-steakhouse'].waAccountId, 'wa-steakhouse');
    assert.equal(byTenant['tenant-steakhouse'].to, '+27820000002');
    assert.match(byTenant['tenant-steakhouse'].text, /^Hi Amahle,/);
    for (const job of jobs) {
      const accountOwner = job.waAccountId === 'wa-bistro' ? 'tenant-bistro' : 'tenant-steakhouse';
      assert.equal(job.tenantId, accountOwner, `${job.waAccountId} must only ever send for its own tenant`);
    }
    assert.deepEqual(sentMarks.map((m) => m.reservationId).sort(), ['r-bistro', 'r-steakhouse']);
  });

  test('a tenant with no connected account cannot send — and cannot borrow another tenant’s', async () => {
    const rows = [fakeRow({ id: 'r-orphan', tenantId: 'tenant-noline', customerName: 'Lerato' })];
    const { store, jobs } = fakeStore(rows, { accounts: { 'tenant-bistro': 'wa-bistro' } });

    await runNoShowCron(store, { now: NOW });
    const summary = await runNoShowCron(store, { now: new Date(NOW.getTime() + hours(3)) });

    assert.equal(summary.followup.sent, 0);
    assert.equal(summary.followup.skipped.noRecipient, 1);
    assert.equal(jobs.length, 0);
    assert.equal(rows[0].noShowFollowupSent, false);
  });
});
