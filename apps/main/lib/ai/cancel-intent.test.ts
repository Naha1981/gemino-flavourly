import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCancellationRequest,
  handleCancellationIntent,
  buildCancellationReply,
  formatReservationWhen,
  CANCEL_NOT_FOUND_MESSAGE,
  type CancelIntentStore,
  type CancelIntentReservation,
} from './cancel-intent.ts';
import {
  runCancellationFollowupCron,
  markReservationCancelled,
  type CancellationFollowupStore,
} from '../revenue/cancellation-followup.ts';

// ── shared clock fixtures ────────────────────────────────────────────────
/** Monday 2026-08-24 18:00 UTC — the instant the customer asks to cancel. */
const NOW = new Date('2026-08-24T18:00:00.000Z');
/** The customer's table: Saturday 2026-08-29 19:00 UTC, party of 4. */
const BOOKED_FOR = new Date('2026-08-29T19:00:00.000Z');

const hours = (n: number) => n * 60 * 60 * 1000;

/** A row in the fake reservations table. */
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

function fakeRow(partial: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'r-1',
    tenantId: 'tenant-a',
    customerName: 'Thabo',
    customerPhone: '+27820000000',
    contactId: 'contact-1',
    conversationId: 'conv-1',
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
 * A LOOSE cancel-intent store: `findCandidateReservations` returns every row
 * for the matching contact/phone in the tenant with NO status or date
 * filtering. That forces the handler to re-validate every safety predicate
 * itself — exactly the defense-in-depth the module promises — rather than
 * trusting a narrow query. `takeoverFor` marks conversations in manual
 * takeover.
 */
function fakeCancelStore(
  rows: FakeRow[],
  options: { takeoverFor?: string[]; cancelled?: string[] } = {}
): { store: CancelIntentStore; cancelled: string[] } {
  const cancelled: string[] = [];
  const takeover = new Set(options.takeoverFor ?? []);
  const store: CancelIntentStore = {
    async isManualTakeover(conversationId) {
      return takeover.has(conversationId);
    },
    async findCandidateReservations({ tenantId, contactId, phone }) {
      return rows
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            ((row.contactId !== null && row.contactId === contactId) ||
              (row.customerPhone !== null && row.customerPhone === phone))
        )
        .map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          contactId: row.contactId,
          customerPhone: row.customerPhone,
          date: row.reservationDate,
          partySize: row.partySize,
          status: row.status,
        })) as CancelIntentReservation[];
    },
    async cancelReservation(reservationId, cancelledAt) {
      const row = rows.find((r) => r.id === reservationId);
      if (!row) throw new Error(`unknown reservation ${reservationId}`);
      row.status = 'cancelled';
      row.cancelledAt = cancelledAt;
      cancelled.push(reservationId);
    },
  };
  return { store, cancelled };
}

// ===========================================================================
// 1. Matcher
// ===========================================================================
describe('cancel intent matcher', () => {
  test('accepts the canonical cancellation requests (case/punctuation-insensitive)', () => {
    const requests = [
      'cancel my booking',
      'Cancel My Booking',
      'CANCEL MY RESERVATION',
      'i need to cancel',
      'cant make it',
      "can't make it",
      'Can\'t make it tonight, sorry',
      '   cancel my booking   ',
      'cancel my booking.',
      'cancel my booking!',
      'Please cancel my reservation for tomorrow',
      'I need to cancel my table',
      "I can't make it anymore",
    ];
    for (const text of requests) {
      assert.equal(isCancellationRequest(text), true, `should match: "${text}"`);
    }
  });

  test('rejects questions about cancellation policy', () => {
    const questions = [
      "what's your cancellation policy",
      'What is your cancellation policy?',
      'can I cancel if I need to?',
      'can i cancel',
      'how do I cancel',
      'do you charge for cancellations',
    ];
    for (const text of questions) {
      assert.equal(isCancellationRequest(text), false, `should NOT match: "${text}"`);
    }
  });

  test('rejects the POPIA opt-out path and never touches it', () => {
    // "cancel subscription" is the POPIA unsubscribe phrase and must be left
    // for isOptOutMessage() in the responder. Even a phrasing that contains a
    // request fragment must not be treated as a table cancellation.
    const optOuts = [
      'cancel subscription',
      'Cancel Subscription',
      'i need to cancel my subscription',
      'unsubscribe',
      'stop',
    ];
    for (const text of optOuts) {
      assert.equal(isCancellationRequest(text), false, `should NOT match: "${text}"`);
    }
  });

  test('is narrower than a bare substring on "cancel"', () => {
    // A bare "cancel" must not fire: these all contain the word but are not
    // requests to cancel a booking.
    const bare = ['cancel', 'cancel?', 'cancellation', 'cancelled', 'cancellations'];
    for (const text of bare) {
      assert.equal(isCancellationRequest(text), false, `bare "cancel"-ish must NOT match: "${text}"`);
    }
  });
});

// ===========================================================================
// 2. Safety decision
// ===========================================================================
describe('cancel intent safety decision', () => {
  const baseInput = {
    tenantId: 'tenant-a',
    contactId: 'contact-1',
    phone: '+27820000000',
    conversationId: 'conv-1',
  };

  test('cancels the upcoming confirmed booking and replies with the details', async () => {
    const rows = [fakeRow()];
    const { store, cancelled } = fakeCancelStore(rows);

    const reply = await handleCancellationIntent({ ...baseInput, now: NOW }, store);

    assert.equal(reply, 'Your table for 4 on 29 August 2026 at 19:00 is cancelled. Sorry to miss you — we\'d love to host you another time.');
    assert.deepEqual(cancelled, ['r-1']);
    assert.equal(rows[0].status, 'cancelled');
    assert.equal(rows[0].cancelledAt?.toISOString(), NOW.toISOString());
  });

  test('tenant isolation: a reservation in another tenant is never cancelled', async () => {
    const rows = [fakeRow({ id: 'r-other', tenantId: 'tenant-b' })];
    const { store, cancelled } = fakeCancelStore(rows);

    const reply = await handleCancellationIntent({ ...baseInput, now: NOW }, store);

    assert.equal(reply, CANCEL_NOT_FOUND_MESSAGE);
    assert.deepEqual(cancelled, []);
    assert.equal(rows[0].status, 'confirmed');
  });

  test('requires a contact OR exact phone match — a stranger is not cancelled', async () => {
    const rows = [fakeRow({ id: 'r-stranger', contactId: 'someone-else', customerPhone: '+27999999999' })];
    const { store, cancelled } = fakeCancelStore(rows);

    const reply = await handleCancellationIntent({ ...baseInput, now: NOW }, store);

    assert.equal(reply, CANCEL_NOT_FOUND_MESSAGE);
    assert.deepEqual(cancelled, []);
  });

  test('a phone-only match (no contact row) still cancels', async () => {
    // A booking taken over the phone may have no contact_id; the exact
    // customer_phone match is the fallback path and must work.
    const rows = [fakeRow({ id: 'r-phone-only', contactId: null, customerPhone: '+27820000000' })];
    const { store, cancelled } = fakeCancelStore(rows);

    const reply = await handleCancellationIntent({ ...baseInput, now: NOW }, store);

    assert.match(reply as string, /is cancelled\./);
    assert.deepEqual(cancelled, ['r-phone-only']);
  });

  test('never cancels a past reservation (18:00 table is not upcoming at 20:00)', async () => {
    const past = fakeRow({ id: 'r-past', reservationDate: new Date('2026-08-24T18:00:00.000Z') });
    const { store, cancelled } = fakeCancelStore([past]);

    // "now" is 20:00 the same day — the 18:00 table has already passed.
    const reply = await handleCancellationIntent(
      { ...baseInput, now: new Date('2026-08-24T20:00:00.000Z') },
      store
    );

    assert.equal(reply, CANCEL_NOT_FOUND_MESSAGE);
    assert.deepEqual(cancelled, []);
    assert.equal(past.status, 'confirmed');
  });

  test('never cancels a completed reservation', async () => {
    const rows = [fakeRow({ id: 'r-done', status: 'completed' })];
    const { store, cancelled } = fakeCancelStore(rows);

    const reply = await handleCancellationIntent({ ...baseInput, now: NOW }, store);

    assert.equal(reply, CANCEL_NOT_FOUND_MESSAGE);
    assert.deepEqual(cancelled, []);
    assert.equal(rows[0].status, 'completed');
  });

  test('never cancels a no-show reservation', async () => {
    const rows = [fakeRow({ id: 'r-noshow', status: 'no_show' })];
    const { store, cancelled } = fakeCancelStore(rows);

    const reply = await handleCancellationIntent({ ...baseInput, now: NOW }, store);

    assert.equal(reply, CANCEL_NOT_FOUND_MESSAGE);
    assert.deepEqual(cancelled, []);
    assert.equal(rows[0].status, 'no_show');
  });

  test('never re-cancels an already-cancelled reservation', async () => {
    const rows = [fakeRow({ id: 'r-already', status: 'cancelled', cancelledAt: new Date('2026-08-20T00:00:00.000Z') })];
    const { store, cancelled } = fakeCancelStore(rows);

    const reply = await handleCancellationIntent({ ...baseInput, now: NOW }, store);

    assert.equal(reply, CANCEL_NOT_FOUND_MESSAGE);
    assert.deepEqual(cancelled, []);
  });

  test('among several upcoming bookings, cancels the soonest (the next one)', async () => {
    const rows = [
      fakeRow({ id: 'r-soonest', reservationDate: new Date('2026-08-26T19:00:00.000Z') }),
      fakeRow({ id: 'r-later', reservationDate: new Date('2026-09-05T19:00:00.000Z') }),
      // A past completed one must be ignored entirely.
      fakeRow({ id: 'r-past-done', status: 'completed', reservationDate: new Date('2026-08-10T19:00:00.000Z') }),
    ];
    const { store, cancelled } = fakeCancelStore(rows);

    const reply = await handleCancellationIntent({ ...baseInput, now: NOW }, store);

    assert.deepEqual(cancelled, ['r-soonest']);
    assert.match(reply as string, /on 26 August 2026 at 19:00/);
  });

  test('manual takeover blocks auto-cancel entirely (defense in depth)', async () => {
    const rows = [fakeRow()];
    const { store, cancelled } = fakeCancelStore(rows, { takeoverFor: ['conv-1'] });

    const reply = await handleCancellationIntent({ ...baseInput, now: NOW }, store);

    // null = no AI reply, the human on the thread handles it.
    assert.equal(reply, null);
    assert.deepEqual(cancelled, []);
    assert.equal(rows[0].status, 'confirmed');
  });

  test('returns the not-found message when there is simply no booking', async () => {
    const { store, cancelled } = fakeCancelStore([]);
    const reply = await handleCancellationIntent({ ...baseInput, now: NOW }, store);
    assert.equal(reply, CANCEL_NOT_FOUND_MESSAGE);
    assert.deepEqual(cancelled, []);
  });
});

// ===========================================================================
// 3. Reply formatting
// ===========================================================================
describe('cancellation reply formatting', () => {
  test('formats the date and time in a stable, readable form', () => {
    assert.deepEqual(formatReservationWhen(new Date('2026-08-29T19:00:00.000Z')), {
      date: '29 August 2026',
      time: '19:00',
    });
    assert.deepEqual(formatReservationWhen(new Date('2026-01-05T08:05:00.000Z')), {
      date: '5 January 2026',
      time: '08:05',
    });
  });

  test('builds the exact confirmation copy', () => {
    assert.equal(
      buildCancellationReply({ partySize: 2, date: new Date('2026-08-29T19:00:00.000Z') }),
      "Your table for 2 on 29 August 2026 at 19:00 is cancelled. Sorry to miss you — we'd love to host you another time."
    );
  });
});

// ===========================================================================
// 4. End to end with the Gate #3 follow-up cron
// ===========================================================================
/**
 * A combined fake over one shared reservations table that implements BOTH the
 * cancel-intent store and the cancellation-followup store — so a cancellation
 * stamped by the AI intent is visible to the Gate #3 cron exactly as it would
 * be in production, where both read the same `reservations` rows.
 */
function combinedStores(
  rows: FakeRow[],
  options: { takeoverFor?: string[] } = {}
): {
  cancelStore: CancelIntentStore;
  followupStore: CancellationFollowupStore;
  jobs: Array<{ tenantId: string; waAccountId: string; to: string; text: string }>;
} {
  const jobs: Array<{ tenantId: string; waAccountId: string; to: string; text: string }> = [];
  const takeover = new Set(options.takeoverFor ?? []);

  const cancelStore: CancelIntentStore = {
    async isManualTakeover(conversationId) {
      return takeover.has(conversationId);
    },
    async findCandidateReservations({ tenantId, contactId, phone }) {
      return rows
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            ((row.contactId !== null && row.contactId === contactId) ||
              (row.customerPhone !== null && row.customerPhone === phone))
        )
        .map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          contactId: row.contactId,
          customerPhone: row.customerPhone,
          date: row.reservationDate,
          partySize: row.partySize,
          status: row.status,
        })) as CancelIntentReservation[];
    },
    async cancelReservation(reservationId, cancelledAt) {
      const row = rows.find((r) => r.id === reservationId);
      if (!row) throw new Error(`unknown reservation ${reservationId}`);
      row.status = 'cancelled';
      row.cancelledAt = cancelledAt;
    },
  };

  const followupStore: CancellationFollowupStore = {
    async findDueCancellations({ limit }) {
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
    async findRecipient(reservation) {
      return {
        to: reservation.customerPhone ?? '+27000000000',
        waAccountId: 'wa-account-1',
        name: reservation.customerName,
      };
    },
    async queueFollowup(input) {
      jobs.push(input);
    },
    async markFollowupSent(reservationId, sentAt) {
      const row = rows.find((r) => r.id === reservationId);
      if (!row) throw new Error(`unknown reservation ${reservationId}`);
      row.cancellationFollowupSent = true;
      row.cancellationFollowupSentAt = sentAt;
    },
    async cancelReservation(reservationId, cancelledAt) {
      await cancelStore.cancelReservation(reservationId, cancelledAt);
    },
  };

  return { cancelStore, followupStore, jobs };
}

describe('cancel intent end to end with Gate #3 follow-up', () => {
  test('a booking + "cancel my booking" stamps the row, confirms, and the cron follows up exactly once at +25h', async () => {
    const row = fakeRow({ id: 'r-e2e', customerName: 'Thabo', reservationDate: BOOKED_FOR });
    const { cancelStore, followupStore, jobs } = combinedStores([row]);

    // 1. A confirmed upcoming booking exists; the cron has nothing to do yet.
    const beforeCancel = await runCancellationFollowupCron(followupStore, { now: NOW });
    assert.equal(beforeCancel.scanned, 0);
    assert.equal(jobs.length, 0);

    // 2. The customer texts "cancel my booking" — the matcher fires, the
    //    handler stamps cancelled_at through the single entry point, and the
    //    reply confirms the exact table.
    assert.equal(isCancellationRequest('cancel my booking'), true);
    const reply = await handleCancellationIntent(
      { tenantId: 'tenant-a', contactId: 'contact-1', phone: '+27820000000', conversationId: 'conv-1', now: NOW },
      cancelStore
    );
    assert.equal(
      reply,
      'Your table for 4 on 29 August 2026 at 19:00 is cancelled. Sorry to miss you — we\'d love to host you another time.'
    );
    assert.equal(row.status, 'cancelled');
    assert.equal(row.cancelledAt?.toISOString(), NOW.toISOString());
    assert.equal(row.cancellationFollowupSent, false); // stamped ready for the cron

    // 3. 23h later: the 24h window has not opened — still no follow-up.
    const tooSoon = await runCancellationFollowupCron(followupStore, { now: new Date(NOW.getTime() + hours(23)) });
    assert.equal(tooSoon.sent, 0);
    assert.equal(jobs.length, 0);

    // 4. 25h later: the follow-up goes out once and the row is marked sent.
    const runAt = new Date(NOW.getTime() + hours(25));
    const dueRun = await runCancellationFollowupCron(followupStore, { now: runAt });
    assert.equal(dueRun.sent, 1);
    assert.equal(jobs.length, 1);
    assert.equal(
      jobs[0].text,
      'Hi Thabo, sorry we missed you! We still have tables available this Saturday. Would you like to rebook?'
    );
    assert.equal(row.cancellationFollowupSent, true);

    // 5. Every later run inside the window is a no-op — never a second message.
    const rerun = await runCancellationFollowupCron(followupStore, { now: new Date(NOW.getTime() + hours(30)) });
    assert.equal(rerun.sent, 0);
    assert.equal(jobs.length, 1);
  });

  test('the AI intent and markReservationCancelled stamp the same way the cron expects', async () => {
    // Belt-and-suspenders: confirm markReservationCancelled (the documented
    // entry point) over the same table produces a row the cron picks up — the
    // AI intent delegates to exactly this function in production.
    const row = fakeRow({ id: 'r-stamp' });
    const { followupStore, jobs } = combinedStores([row]);

    await markReservationCancelled(followupStore, 'r-stamp', NOW);
    assert.equal(row.status, 'cancelled');
    assert.equal(row.cancelledAt?.toISOString(), NOW.toISOString());

    const dueRun = await runCancellationFollowupCron(followupStore, {
      now: new Date(NOW.getTime() + hours(25)),
    });
    assert.equal(dueRun.sent, 1);
    assert.equal(jobs.length, 1);
  });
});
