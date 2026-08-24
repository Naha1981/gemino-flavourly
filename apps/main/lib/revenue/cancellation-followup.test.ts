import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFollowupMessage,
  computeCancellationWindow,
  followupEligibility,
  markReservationCancelled,
  nextOccurrenceOfWeekday,
  runCancellationFollowupCron,
  FOLLOWUP_DELAY_HOURS,
  FOLLOWUP_MAX_AGE_DAYS,
  type CancellationFollowupStore,
  type CancelledReservation,
} from './cancellation-followup.ts';

/** Monday 07:00 — the same hour the daily brief runs. */
const NOW = new Date('2026-08-24T07:00:00.000Z');
/** The table the customer booked: Saturday dinner. */
const BOOKED_FOR = new Date('2026-08-22T19:00:00.000Z');

const hours = (n: number) => n * 60 * 60 * 1000;
const cancelledHoursAgo = (n: number, from: Date = NOW) => new Date(from.getTime() - hours(n));

/** A row in the fake `reservations` table. */
interface FakeRow {
  id: string;
  tenantId: string;
  customerName: string | null;
  customerPhone: string | null;
  contactId: string | null;
  conversationId: string | null;
  reservationDate: Date;
  partySize: number;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  cancelledAt: Date | null;
  cancellationFollowupSent: boolean;
  cancellationFollowupSentAt: Date | null;
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
    reservationDate: BOOKED_FOR,
    partySize: 4,
    status: 'confirmed',
    cancelledAt: null,
    cancellationFollowupSent: false,
    cancellationFollowupSentAt: null,
    ...partial,
  };
}

/**
 * An in-memory stand-in for the reservations table.
 *
 * `findDueCancellations` deliberately applies ONLY the cheap predicates
 * (status, cancelled_at present, not yet sent) and ignores the time window —
 * a wider result set than the real query returns, so the tests also prove
 * the analytics re-check the window instead of trusting the query.
 *
 * `noRecipientFor` and `failQueueFor` simulate the two real failure modes:
 * no route to the customer, and the outbox insert throwing.
 */
function fakeStore(rows: FakeRow[], options: { noRecipientFor?: string[]; failQueueFor?: string[] } = {}) {
  const jobs: QueuedJob[] = [];
  const queries: Array<{ cancelledBefore: Date; cancelledAfter: Date; limit: number }> = [];

  const store: CancellationFollowupStore = {
    async findDueCancellations({ cancelledBefore, cancelledAfter, limit }) {
      queries.push({ cancelledBefore, cancelledAfter, limit });
      return rows
        .filter((row) => row.status === 'cancelled' && row.cancelledAt && !row.cancellationFollowupSent)
        .slice(0, limit)
        .map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          contactId: row.contactId,
          conversationId: row.conversationId,
          reservationDate: row.reservationDate,
          partySize: row.partySize,
          cancelledAt: row.cancelledAt as Date,
        }));
    },

    async findRecipient(reservation: CancelledReservation) {
      if (options.noRecipientFor?.includes(reservation.id)) return null;
      return { to: reservation.customerPhone ?? '+27000000000', waAccountId: 'wa-account-1', name: reservation.customerName };
    },

    async queueFollowup(input) {
      if (options.failQueueFor?.some((id) => input.text.includes(id))) throw new Error('outbox insert failed');
      jobs.push(input);
    },

    async markFollowupSent(reservationId, sentAt) {
      const row = rows.find((r) => r.id === reservationId);
      if (!row) throw new Error(`unknown reservation ${reservationId}`);
      row.cancellationFollowupSent = true;
      row.cancellationFollowupSentAt = sentAt;
    },

    async cancelReservation(reservationId, cancelledAt) {
      const row = rows.find((r) => r.id === reservationId);
      if (!row) throw new Error(`unknown reservation ${reservationId}`);
      row.status = 'cancelled';
      row.cancelledAt = cancelledAt;
    },
  };

  return { store, jobs, queries, rows };
}

describe('cancellation follow-up window', () => {
  test('the window is 24h ago back to 7 days ago', () => {
    const window = computeCancellationWindow(NOW);
    assert.equal(window.cancelledBefore.toISOString(), '2026-08-23T07:00:00.000Z');
    assert.equal(window.cancelledAfter.toISOString(), '2026-08-17T07:00:00.000Z');
    assert.equal(FOLLOWUP_DELAY_HOURS, 24);
    assert.equal(FOLLOWUP_MAX_AGE_DAYS, 7);
  });

  test('identifies cancellations from 24h to 7d ago as due', () => {
    const due = [24.01, 25, 48, 96, 167, 167.99];
    for (const h of due) {
      assert.equal(
        followupEligibility({ cancelledAt: cancelledHoursAgo(h) }, { now: NOW }),
        'due',
        `${h}h ago should be due`
      );
    }
  });

  test('a cancellation younger than 24h is not yet due (the bound is strict)', () => {
    for (const h of [0.5, 1, 12, 23, 23.99, 24]) {
      assert.equal(
        followupEligibility({ cancelledAt: cancelledHoursAgo(h) }, { now: NOW }),
        'not_yet_due',
        `${h}h ago should not be due yet`
      );
    }
  });

  test('a cancellation older than 7 days is never followed up (the bound is strict)', () => {
    for (const h of [168, 169, 240, 24 * 365]) {
      assert.equal(
        followupEligibility({ cancelledAt: cancelledHoursAgo(h) }, { now: NOW }),
        'too_old',
        `${h}h ago should be too old`
      );
    }
  });

  test('the thresholds are configurable', () => {
    const window = computeCancellationWindow(NOW, { delayHours: 1, maxAgeDays: 1 });
    assert.equal(window.cancelledBefore.toISOString(), '2026-08-24T06:00:00.000Z');
    assert.equal(window.cancelledAfter.toISOString(), '2026-08-23T07:00:00.000Z');
    assert.equal(followupEligibility({ cancelledAt: cancelledHoursAgo(2) }, { now: NOW, delayHours: 1 }), 'due');
  });
});

describe('cancellation follow-up message', () => {
  test('offers the same weekday as the cancelled reservation', () => {
    assert.equal(
      buildFollowupMessage({ customerName: 'Thabo', reservationDate: BOOKED_FOR, now: NOW }),
      'Hi Thabo, sorry we missed you! We still have tables available this Saturday. Would you like to rebook?'
    );
  });

  test('a Tuesday booking offers Tuesday', () => {
    const text = buildFollowupMessage({
      customerName: 'Amahle',
      reservationDate: new Date('2026-08-18T19:00:00.000Z'),
      now: NOW,
    });
    assert.equal(
      text,
      'Hi Amahle, sorry we missed you! We still have tables available this Tuesday. Would you like to rebook?'
    );
  });

  test('falls back to "there" when there is no name', () => {
    for (const name of [null, undefined, '', '   ']) {
      const text = buildFollowupMessage({ customerName: name, reservationDate: BOOKED_FOR, now: NOW });
      assert.match(text, /^Hi there, sorry we missed you!/);
    }
  });

  test('the offered date is always in the future', () => {
    // Booked for a Tuesday, cancelled on a Wednesday: the next Tuesday is
    // six days away, not yesterday.
    const now = new Date('2026-08-26T07:00:00.000Z'); // Wednesday
    const bookedForTuesday = new Date('2026-08-25T19:00:00.000Z');
    const offered = nextOccurrenceOfWeekday(bookedForTuesday, now);

    assert.equal(offered.toISOString().slice(0, 10), '2026-09-01');
    assert.ok(offered.getTime() > now.getTime());
    assert.equal(offered.getUTCDay(), bookedForTuesday.getUTCDay());
  });
});

describe('cancellation follow-up cron (integration)', () => {
  test('queues one follow-up per due cancellation and marks it sent', async () => {
    const rows = [
      fakeRow({ id: 'r-due-1', status: 'cancelled', cancelledAt: cancelledHoursAgo(26), customerName: 'Thabo' }),
      fakeRow({ id: 'r-due-2', status: 'cancelled', cancelledAt: cancelledHoursAgo(50), customerName: 'Amahle' }),
    ];
    const { store, jobs } = fakeStore(rows);

    const summary = await runCancellationFollowupCron(store, { now: NOW });

    assert.equal(summary.scanned, 2);
    assert.equal(summary.sent, 2);
    assert.deepEqual(jobs, [
      {
        tenantId: 'tenant-bistro',
        waAccountId: 'wa-account-1',
        to: '+27820000000',
        text: 'Hi Thabo, sorry we missed you! We still have tables available this Saturday. Would you like to rebook?',
      },
      {
        tenantId: 'tenant-bistro',
        waAccountId: 'wa-account-1',
        to: '+27820000000',
        text: 'Hi Amahle, sorry we missed you! We still have tables available this Saturday. Would you like to rebook?',
      },
    ]);
    assert.deepEqual(rows.map((row) => row.cancellationFollowupSent), [true, true]);
    assert.deepEqual(rows.map((row) => row.cancellationFollowupSentAt?.toISOString()), [
      NOW.toISOString(),
      NOW.toISOString(),
    ]);
  });

  test('asks for the window the query should use', async () => {
    const { store, queries } = fakeStore([]);
    await runCancellationFollowupCron(store, { now: NOW, limit: 25 });

    assert.equal(queries.length, 1);
    assert.equal(queries[0].cancelledBefore.toISOString(), '2026-08-23T07:00:00.000Z');
    assert.equal(queries[0].cancelledAfter.toISOString(), '2026-08-17T07:00:00.000Z');
    assert.equal(queries[0].limit, 25);
  });

  test('ignores rows outside the window even if the query returns them', async () => {
    const rows = [
      fakeRow({ id: 'r-fresh', status: 'cancelled', cancelledAt: cancelledHoursAgo(2) }),
      fakeRow({ id: 'r-due', status: 'cancelled', cancelledAt: cancelledHoursAgo(30) }),
      fakeRow({ id: 'r-ancient', status: 'cancelled', cancelledAt: cancelledHoursAgo(24 * 30) }),
    ];
    const { store, jobs } = fakeStore(rows);

    const summary = await runCancellationFollowupCron(store, { now: NOW });

    assert.equal(summary.scanned, 3);
    assert.equal(summary.sent, 1);
    assert.equal(summary.skipped.notYetDue, 1);
    assert.equal(summary.skipped.tooOld, 1);
    assert.equal(jobs.length, 1);
    assert.deepEqual(rows.map((row) => row.cancellationFollowupSent), [false, true, false]);
  });

  test('leaves a reservation unmarked when there is no way to reach the customer', async () => {
    const rows = [fakeRow({ id: 'r-unreachable', status: 'cancelled', cancelledAt: cancelledHoursAgo(30) })];
    const { store, jobs } = fakeStore(rows, { noRecipientFor: ['r-unreachable'] });

    const summary = await runCancellationFollowupCron(store, { now: NOW });

    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped.noRecipient, 1);
    assert.equal(jobs.length, 0);
    // Not marked, so the next run retries once WhatsApp reconnects.
    assert.equal(rows[0].cancellationFollowupSent, false);
  });

  test('a queue failure does not mark the row sent or abort the batch', async () => {
    const rows = [
      fakeRow({ id: 'r-boom', status: 'cancelled', cancelledAt: cancelledHoursAgo(30), customerName: 'r-boom' }),
      fakeRow({ id: 'r-fine', status: 'cancelled', cancelledAt: cancelledHoursAgo(31), customerName: 'Sipho' }),
    ];
    const { store, jobs } = fakeStore(rows, { failQueueFor: ['r-boom'] });

    const summary = await runCancellationFollowupCron(store, { now: NOW });

    assert.equal(summary.sent, 1);
    assert.equal(summary.skipped.failed, 1);
    assert.deepEqual(rows.map((row) => row.cancellationFollowupSent), [false, true]);
    assert.equal(jobs.length, 1);
    assert.match(jobs[0].text, /^Hi Sipho,/);
  });
});

describe('cancellation follow-up end to end (mocked clock)', () => {
  test('cancel a reservation, wait 24h, and the follow-up goes out exactly once', async () => {
    const row = fakeRow({ id: 'r-e2e', customerName: 'Thabo', reservationDate: BOOKED_FOR });
    const { store, jobs, rows } = fakeStore([row]);
    const cancelledAt = NOW;

    // 1. A confirmed booking is nobody's business yet.
    const beforeCancel = await runCancellationFollowupCron(store, { now: NOW });
    assert.equal(beforeCancel.scanned, 0);
    assert.equal(jobs.length, 0);

    // 2. The customer cancels — the only supported way to stamp cancelled_at.
    await markReservationCancelled(store, 'r-e2e', cancelledAt);
    assert.equal(rows[0].status, 'cancelled');
    assert.equal(rows[0].cancelledAt?.toISOString(), cancelledAt.toISOString());

    // 3. 23 hours later: still too soon.
    const tooSoon = await runCancellationFollowupCron(store, { now: new Date(cancelledAt.getTime() + hours(23)) });
    assert.equal(tooSoon.sent, 0);
    assert.equal(jobs.length, 0);

    // 4. 25 hours later: the follow-up is queued and the row is marked.
    const runAt = new Date(cancelledAt.getTime() + hours(25));
    const dueRun = await runCancellationFollowupCron(store, { now: runAt });

    assert.equal(dueRun.scanned, 1);
    assert.equal(dueRun.sent, 1);
    assert.equal(jobs.length, 1);
    assert.equal(
      jobs[0].text,
      'Hi Thabo, sorry we missed you! We still have tables available this Saturday. Would you like to rebook?'
    );
    assert.equal(rows[0].cancellationFollowupSent, true);
    assert.equal(rows[0].cancellationFollowupSentAt?.toISOString(), runAt.toISOString());

    // 5. Every later run inside the window is a no-op: no second message.
    const rerun = await runCancellationFollowupCron(store, { now: new Date(cancelledAt.getTime() + hours(30)) });
    assert.equal(rerun.scanned, 0);
    assert.equal(jobs.length, 1);

    // 6. Eight days after the cancellation it is too old, even if the flag
    //    had somehow been reset.
    rows[0].cancellationFollowupSent = false;
    const tooOld = await runCancellationFollowupCron(store, { now: new Date(cancelledAt.getTime() + hours(24 * 8)) });
    assert.equal(tooOld.sent, 0);
    assert.equal(tooOld.skipped.tooOld, 1);
    assert.equal(jobs.length, 1);
  });

  test('a customer who cancels twice is still only messaged once', async () => {
    const row = fakeRow({ id: 'r-twice' });
    const { store, jobs } = fakeStore([row]);

    await markReservationCancelled(store, 'r-twice', cancelledHoursAgo(30));
    await markReservationCancelled(store, 'r-twice', cancelledHoursAgo(1));
    const summary = await runCancellationFollowupCron(store, { now: NOW });

    // The second cancellation restarts the 24h clock.
    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped.notYetDue, 1);
    assert.equal(jobs.length, 0);
  });
});
