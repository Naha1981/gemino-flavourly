import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNoShowMessage,
  detectionCutoff,
  isNoShowDue,
  isNoShowDueReference,
  nextWeekendDay,
  noShowFollowupEligibility,
  runNoShowCron,
  DETECTION_GRACE_HOURS,
  FOLLOWUP_DELAY_HOURS,
  DEFAULT_LIMIT,
  type NoShowReservation,
  type NoShowStore,
} from './no-show.ts';
import { DAY_NAMES } from './slow-days.ts';

const HOUR = 60 * 60 * 1000;

/** Sunday dinner — the table the customer booked and missed. */
const BOOKED_FOR = new Date('2026-08-23T19:00:00.000Z');

/** A row in the fake `reservations` table. */
function fakeRow(partial: Partial<NoShowReservation> = {}): NoShowReservation {
  return {
    id: 'reservation-1',
    tenantId: 'tenant-a',
    customerName: 'Thabo',
    customerPhone: '+27811111111',
    contactId: 'contact-1',
    conversationId: 'conversation-1',
    reservationDate: BOOKED_FOR,
    partySize: 4,
    status: 'confirmed',
    noShowDetected: false,
    noShowDetectedAt: null,
    noShowFollowupSent: false,
    noShowFollowupSentAt: null,
    manualTakeover: false,
    ...partial,
  };
}

interface FakeTenant {
  id: string;
  aiEnabled: boolean;
  manualMode: boolean;
  connectedWaAccountId: string | null;
}
interface FakeContact {
  id: string;
  phone: string;
  name: string | null;
  blocklisted: boolean;
}
interface FakeConversation {
  id: string;
  waAccountId: string | null;
  manualTakeover: boolean;
  contactId: string | null;
}

interface QueuedJob {
  tenantId: string;
  waAccountId: string;
  to: string;
  text: string;
}

interface FakeWorld {
  rows: NoShowReservation[];
  tenants: Map<string, FakeTenant>;
  contacts: Map<string, FakeContact>;
  conversations: Map<string, FakeConversation>;
  jobs: QueuedJob[];
  queries: {
    detect: Array<{ cutoff: Date; limit: number }>;
    due: Array<{ detectedBefore: Date; limit: number }>;
  };
  /** Outbox insert throws for jobs addressed to these numbers. */
  failQueueFor?: Set<string>;
  /** Row ids the scan leaks past the manual-takeover filter (defense-in-depth tests). */
  leakTakeover?: Set<string>;
  /** Row ids the scan leaks past the opt-out filter (defense-in-depth tests). */
  leakOptOut?: Set<string>;
  /** Row ids the detection scan leaks past the status filter (defense-in-depth tests). */
  leakStatus?: Set<string>;
}

function fakeWorld(
  rows: NoShowReservation[],
  partial: {
    tenants?: Array<Partial<FakeTenant> & { id: string }>;
    contacts?: FakeContact[];
    conversations?: FakeConversation[];
    failQueueFor?: string[];
    leakTakeover?: string[];
    leakOptOut?: string[];
    leakStatus?: string[];
  } = {}
): FakeWorld {
  return {
    rows,
    tenants: new Map(
      (partial.tenants ?? [{ id: 'tenant-a', aiEnabled: true, manualMode: false, connectedWaAccountId: 'wa-a' }]).map(
        (t) => [t.id, { aiEnabled: true, manualMode: false, connectedWaAccountId: `wa-${t.id.replace('tenant-', '')}`, ...t }]
      )
    ),
    contacts: new Map(
      (partial.contacts ?? [{ id: 'contact-1', phone: '+27811111111', name: 'Thabo', blocklisted: false }]).map(
        (c) => [c.id, c]
      )
    ),
    conversations: new Map(
      (partial.conversations ?? [
        { id: 'conversation-1', waAccountId: 'wa-a', manualTakeover: false, contactId: 'contact-1' },
      ]).map((c) => [c.id, c])
    ),
    jobs: [],
    queries: { detect: [], due: [] },
    failQueueFor: partial.failQueueFor ? new Set(partial.failQueueFor) : undefined,
    leakTakeover: partial.leakTakeover ? new Set(partial.leakTakeover) : undefined,
    leakOptOut: partial.leakOptOut ? new Set(partial.leakOptOut) : undefined,
    leakStatus: partial.leakStatus ? new Set(partial.leakStatus) : undefined,
  };
}

/**
 * An in-memory stand-in for the reservations/tenants/contacts/
 * conversations tables.
 *
 * `findDetectable` deliberately applies ONLY the cheap predicates
 * (status, detected flag) and ignores the cutoff — a wider result set
 * than the real query returns, so the tests also prove the runner
 * re-checks the cutoff instead of trusting the query. `findFollowupDue`
 * applies the real SQL filters (tenant AI / manual mode, opt-out,
 * manual takeover) but likewise ignores the 2-hour bound, for the same
 * reason. The `leak*` options force a row through one filter so the
 * runner's own re-validation can be tested.
 */
function fakeStore(world: FakeWorld): NoShowStore {
  const { rows, tenants, contacts, conversations, jobs, queries } = world;
  const leakTakeover = world.leakTakeover ?? new Set<string>();
  const leakOptOut = world.leakOptOut ?? new Set<string>();
  const leakStatus = world.leakStatus ?? new Set<string>();

  return {
    async findDetectable({ cutoff, limit }) {
      queries.detect.push({ cutoff, limit });
      return rows
        .filter((row) => (row.status === 'confirmed' || leakStatus.has(row.id)) && !row.noShowDetected)
        .sort((a, b) => a.reservationDate.getTime() - b.reservationDate.getTime())
        .slice(0, limit);
    },

    async findFollowupDue({ detectedBefore, limit }) {
      queries.due.push({ detectedBefore, limit });
      return rows
        .filter((row) => {
          if (row.noShowFollowupSent || !row.noShowDetectedAt) return false;
          const tenant = tenants.get(row.tenantId);
          if (!tenant || !tenant.aiEnabled || tenant.manualMode) return false;
          const contact = row.contactId ? contacts.get(row.contactId) : undefined;
          if (contact?.blocklisted && !leakOptOut.has(row.id)) return false;
          const conversation = row.conversationId ? conversations.get(row.conversationId) : undefined;
          if (conversation?.manualTakeover && !leakTakeover.has(row.id)) return false;
          return true;
        })
        .sort((a, b) => a.noShowDetectedAt!.getTime() - b.noShowDetectedAt!.getTime())
        .slice(0, limit)
        .map((row) => ({
          ...row,
          manualTakeover: row.conversationId
            ? Boolean(conversations.get(row.conversationId)?.manualTakeover)
            : false,
        }));
    },

    async findRecipient(reservation) {
      const tenant = tenants.get(reservation.tenantId);
      const conversation = reservation.conversationId
        ? conversations.get(reservation.conversationId) ?? null
        : null;

      // Defense in depth: staff may have taken over the thread after the
      // scan ran.
      if (conversation?.manualTakeover) return null;

      let contact: FakeContact | undefined = reservation.contactId ? contacts.get(reservation.contactId) : undefined;
      if (contact?.blocklisted) contact = undefined;
      if (!contact && conversation?.contactId) contact = contacts.get(conversation.contactId);
      if (contact?.blocklisted) contact = undefined;

      const to = contact?.phone || reservation.customerPhone || undefined;
      if (!to) return null;

      const waAccountId = conversation?.waAccountId ?? tenant?.connectedWaAccountId ?? undefined;
      if (!waAccountId) return null;

      return { to, waAccountId, name: contact?.name || reservation.customerName };
    },

    async queueFollowup(input) {
      if (world.failQueueFor?.has(input.to)) throw new Error('outbox insert failed');
      jobs.push(input);
    },

    async markDetected(reservationId, detectedAt) {
      const row = rows.find((r) => r.id === reservationId);
      if (!row) throw new Error(`unknown reservation ${reservationId}`);
      row.noShowDetected = true;
      row.noShowDetectedAt = detectedAt;
    },

    async markFollowupSent(reservationId, sentAt) {
      const row = rows.find((r) => r.id === reservationId);
      if (!row) throw new Error(`unknown reservation ${reservationId}`);
      row.noShowFollowupSent = true;
      row.noShowFollowupSentAt = sentAt;
    },
  };
}

/** A pre-stamped no-show: detected at 23:00 Sunday, 2.5h before the Monday 01:30 "now" most safety tests use. */
function detectedRow(partial: Partial<NoShowReservation> = {}): NoShowReservation {
  return fakeRow({
    noShowDetected: true,
    noShowDetectedAt: new Date('2026-08-23T23:00:00.000Z'),
    ...partial,
  });
}

// ---------------------------------------------------------------------------
// Unit: the detection cutoff
// ---------------------------------------------------------------------------

describe('detection cutoff: max(start-of-today, now − 2h)', () => {
  test('the cutoff is max(start of today, now − 2h)', () => {
    // After 02:00, now − 2h is ahead of midnight: the grace bound wins.
    assert.equal(detectionCutoff(new Date('2026-08-24T21:30:00.000Z')).toISOString(), '2026-08-24T19:30:00.000Z');
    assert.equal(detectionCutoff(new Date('2026-08-24T02:00:01.000Z')).toISOString(), '2026-08-24T00:00:01.000Z');
    // Between 00:00 and 02:00, the day boundary wins.
    assert.equal(detectionCutoff(new Date('2026-08-24T00:30:00.000Z')).toISOString(), '2026-08-24T00:00:00.000Z');
    assert.equal(detectionCutoff(new Date('2026-08-24T01:30:00.000Z')).toISOString(), '2026-08-24T00:00:00.000Z');
    assert.equal(detectionCutoff(new Date('2026-08-24T02:00:00.000Z')).toISOString(), '2026-08-24T00:00:00.000Z');
  });

  test('the 23:30 booking is caught by the 00:30 check (the day-boundary edge)', () => {
    const booked = new Date('2026-08-20T23:30:00.000Z');
    assert.equal(isNoShowDue(booked, new Date('2026-08-20T23:59:00.000Z')), false);
    assert.equal(isNoShowDue(booked, new Date('2026-08-21T00:30:00.000Z')), true);
    // Sanity: at 00:30 the plain 2-hour grace has NOT elapsed — only the
    // day-boundary refinement flags this booking. A pure now − 2h cutoff
    // would sit here undetected until 01:30.
    assert.ok(booked.getTime() >= new Date('2026-08-21T00:30:00.000Z').getTime() - 2 * HOUR);
  });

  test('a normal dinner is due only after the full 2h grace (strict bound)', () => {
    const booked = new Date('2026-08-20T19:00:00.000Z');
    assert.equal(isNoShowDue(booked, new Date('2026-08-20T20:59:59.000Z')), false);
    assert.equal(isNoShowDue(booked, new Date('2026-08-20T21:00:00.000Z')), false); // exactly 2h
    assert.equal(isNoShowDue(booked, new Date('2026-08-20T21:00:01.000Z')), true);
  });

  test('a booking from a past day is due on the first scan of a new day', () => {
    const booked = new Date('2026-08-19T19:00:00.000Z');
    assert.equal(isNoShowDue(booked, new Date('2026-08-20T00:00:00.000Z')), true);
  });

  test('bookings inside the grace period, or in the future, are never due', () => {
    const now = new Date('2026-08-24T21:30:00.000Z');
    assert.equal(isNoShowDue(new Date('2026-08-24T19:00:00.000Z'), now), true); // 2.5h ago — due
    assert.equal(isNoShowDue(new Date('2026-08-24T19:30:00.000Z'), now), false); // exactly 2h — strict
    assert.equal(isNoShowDue(new Date('2026-08-24T20:00:00.000Z'), now), false); // 1.5h ago
    assert.equal(isNoShowDue(new Date('2026-08-25T19:00:00.000Z'), now), false); // tomorrow
  });
});

describe('detection cutoff equivalence across a 97-hour sweep', () => {
  // Bookings spanning every interesting edge: a past dinner, lunch,
  // the 23:30 day-boundary case on two consecutive days, a just-after-
  // midnight booking, and a booking from before the sweep starts.
  const BOOKINGS = [
    new Date('2026-08-19T19:00:00.000Z'),
    new Date('2026-08-20T12:00:00.000Z'),
    new Date('2026-08-20T19:00:00.000Z'),
    new Date('2026-08-20T23:30:00.000Z'),
    new Date('2026-08-21T00:15:00.000Z'),
    new Date('2026-08-21T23:30:00.000Z'),
    new Date('2026-08-22T19:00:00.000Z'),
  ];
  const SWEEP_START = new Date('2026-08-20T00:00:00.000Z');
  const STEPS = 97 * 2; // 97 hours of "now", in 30-minute steps

  test('cutoff form and two-clause form agree at every instant', () => {
    for (let step = 0; step <= STEPS; step += 1) {
      const now = new Date(SWEEP_START.getTime() + step * 30 * 60 * 1000);
      for (const bookedFor of BOOKINGS) {
        assert.equal(
          isNoShowDue(bookedFor, now),
          isNoShowDueReference(bookedFor, now),
          `disagreement: booked ${bookedFor.toISOString()} at now ${now.toISOString()}`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Unit: the follow-up window and the message
// ---------------------------------------------------------------------------

describe('follow-up window: 2 hours after the STAMP, strict', () => {
  const detectedAt = new Date('2026-08-24T21:30:00.000Z');

  test('exactly 2h is not yet due; one second past is due', () => {
    assert.equal(noShowFollowupEligibility({ noShowDetectedAt: detectedAt }, { now: new Date('2026-08-24T23:30:00.000Z') }), 'not_yet_due');
    assert.equal(noShowFollowupEligibility({ noShowDetectedAt: detectedAt }, { now: new Date('2026-08-24T23:30:01.000Z') }), 'due');
    assert.equal(noShowFollowupEligibility({ noShowDetectedAt: detectedAt }, { now: new Date('2026-08-25T03:00:00.000Z') }), 'due');
  });

  test('an undetected row is never due', () => {
    assert.equal(noShowFollowupEligibility({ noShowDetectedAt: null }, { now: new Date('2026-08-25T03:00:00.000Z') }), 'not_yet_due');
  });

  test('the constants are the gate values', () => {
    assert.equal(DETECTION_GRACE_HOURS, 2);
    assert.equal(FOLLOWUP_DELAY_HOURS, 2);
    assert.equal(DEFAULT_LIMIT, 50);
  });
});

describe('next weekend day and message copy', () => {
  // [send time, offered date, offered weekday]
  const CASES: Array<[string, string, string]> = [
    ['2026-08-24T22:00:00.000Z', '2026-08-29', 'Saturday'], // Monday
    ['2026-08-25T22:00:00.000Z', '2026-08-29', 'Saturday'], // Tuesday
    ['2026-08-26T22:00:00.000Z', '2026-08-29', 'Saturday'], // Wednesday
    ['2026-08-27T22:00:00.000Z', '2026-08-29', 'Saturday'], // Thursday
    ['2026-08-28T22:00:00.000Z', '2026-08-29', 'Saturday'], // Friday
    ['2026-08-29T22:00:00.000Z', '2026-08-30', 'Sunday'], // Saturday night -> Sunday
    ['2026-08-30T22:00:00.000Z', '2026-09-05', 'Saturday'], // Sunday night -> next Saturday
  ];

  for (const [nowIso, dateStr, weekday] of CASES) {
    test(`a miss on ${dateStr} offers ${weekday}`, () => {
      const now = new Date(nowIso);
      const weekend = nextWeekendDay(now);
      assert.equal(weekend.toISOString().slice(0, 10), dateStr);
      assert.equal(DAY_NAMES[weekend.getUTCDay()], weekday);
      // Strictly after today: the missed night itself is never offered.
      assert.ok(weekend.getTime() > new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime());
      assert.equal(
        buildNoShowMessage({ customerName: 'Thabo', now }),
        `Hi Thabo, we missed you tonight! We still have tables available this ${weekday}. Would you like to rebook?`
      );
    });
  }

  test('falls back to "there" when there is no name', () => {
    const now = new Date('2026-08-24T22:00:00.000Z');
    for (const name of [null, undefined, '', '   ']) {
      assert.equal(
        buildNoShowMessage({ customerName: name, now }),
        'Hi there, we missed you tonight! We still have tables available this Saturday. Would you like to rebook?'
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: the cron run against the fake store
// ---------------------------------------------------------------------------

describe('no-show cron (integration)', () => {
  test('detects and stamps, then sends the follow-up only after the 2h delay', async () => {
    const row = fakeRow();
    const world = fakeWorld([row]);
    const store = fakeStore(world);

    // Run 1 (2.5h after the booking): detected and stamped — but the
    // stamp is `now`, so Phase 2 of the SAME run cannot message it.
    const run1 = await runNoShowCron(store, { now: new Date('2026-08-23T21:30:00.000Z') });
    assert.equal(run1.detected, 1);
    assert.equal(run1.sent, 0);
    assert.equal(row.noShowDetected, true);
    assert.equal(row.noShowDetectedAt?.toISOString(), '2026-08-23T21:30:00.000Z');
    // The store was asked for the right detection cutoff.
    assert.equal(world.queries.detect[0].cutoff.toISOString(), '2026-08-23T19:30:00.000Z');

    // Run 2, exactly 2h after the stamp: the bound is strict — still no message.
    const run2 = await runNoShowCron(store, { now: new Date('2026-08-23T23:30:00.000Z') });
    assert.equal(run2.detected, 0);
    assert.equal(run2.sent, 0);
    assert.equal(run2.skipped.notYetDue, 1);
    assert.equal(world.jobs.length, 0);

    // Run 3, 2.5h after the stamp: the offer goes out and the row is marked.
    const run3At = new Date('2026-08-24T00:00:30.000Z');
    const run3 = await runNoShowCron(store, { now: run3At });
    assert.equal(run3.sent, 1);
    assert.equal(world.jobs.length, 1);
    assert.equal(world.queries.due[2].detectedBefore.toISOString(), '2026-08-23T22:00:30.000Z');
    assert.equal(row.noShowFollowupSent, true);
    assert.equal(row.noShowFollowupSentAt?.toISOString(), run3At.toISOString());
  });

  test('asks for the default 50-row limit on both scans, and honours an override', async () => {
    const world = fakeWorld([]);
    const store = fakeStore(world);
    await runNoShowCron(store, { now: new Date('2026-08-24T21:30:00.000Z') });
    assert.equal(world.queries.detect[0].limit, DEFAULT_LIMIT);
    assert.equal(world.queries.due[0].limit, DEFAULT_LIMIT);

    await runNoShowCron(store, { now: new Date('2026-08-24T21:30:00.000Z'), limit: 25 });
    assert.equal(world.queries.detect[1].limit, 25);
    assert.equal(world.queries.due[1].limit, 25);
  });

  test('re-validates the detection predicates itself (a too-wide query stamps nothing)', async () => {
    const rows = [
      fakeRow({ id: 'r-due', reservationDate: BOOKED_FOR }),
      // The real query would never return these: a future booking (cutoff
      // re-check) and a row that was cancelled between scan and loop
      // (status re-check, leaked past the scan's own filter).
      fakeRow({ id: 'r-future', reservationDate: new Date('2026-08-25T19:00:00.000Z') }),
      fakeRow({ id: 'r-cancelled', status: 'cancelled' }),
    ];
    const world = fakeWorld(rows, { leakStatus: ['r-cancelled'] });
    const summary = await runNoShowCron(fakeStore(world), { now: new Date('2026-08-24T21:30:00.000Z') });

    assert.equal(summary.detected, 1);
    assert.equal(summary.skipped.stale, 2);
    assert.equal(rows[0].noShowDetected, true);
    assert.equal(rows[1].noShowDetected, false);
    assert.equal(rows[2].noShowDetected, false);
  });

  test('a failed detection stamp does not abort the batch', async () => {
    const rows = [
      fakeRow({ id: 'r-ok' }),
      fakeRow({ id: 'r-boom', customerName: 'Boom' }),
    ];
    const world = fakeWorld(rows);
    const store = fakeStore(world);
    // Simulate a transient DB error on one row's stamp.
    const original = store.markDetected.bind(store);
    store.markDetected = async (id, at) => {
      if (id === 'r-boom') throw new Error('transient db error');
      return original(id, at);
    };

    const summary = await runNoShowCron(store, { now: new Date('2026-08-24T21:30:00.000Z') });

    assert.equal(summary.detected, 1);
    assert.equal(summary.skipped.failed, 1);
    assert.equal(rows[0].noShowDetected, true);
    assert.equal(rows[1].noShowDetected, false); // retried next run
  });
});

// ---------------------------------------------------------------------------
// End to end (mocked clock): the gate scenario
// ---------------------------------------------------------------------------

describe('no-show end to end (mocked clock)', () => {
  test("yesterday's booking: run 1 detects, run 2 (+1h) no message, run 3 (+3h) sent once, run 4 no duplicate", async () => {
    const row = fakeRow({ customerName: 'Thabo' });
    const world = fakeWorld([row]);
    const store = fakeStore(world);

    // Run 1 — 2.5h after Sunday's 19:00 booking: the no-show is detected.
    const run1 = await runNoShowCron(store, { now: new Date('2026-08-23T21:30:00.000Z') });
    assert.equal(run1.detected, 1);
    assert.equal(run1.sent, 0);
    assert.equal(row.noShowDetectedAt?.toISOString(), '2026-08-23T21:30:00.000Z');

    // Run 2 — +1h: detected, but the 2h follow-up delay has not elapsed.
    const run2 = await runNoShowCron(store, { now: new Date('2026-08-23T22:30:00.000Z') });
    assert.equal(run2.sent, 0);
    assert.equal(world.jobs.length, 0);

    // Run 3 — +3h (01:30 Monday): the rebook offer goes out, exactly once.
    const run3 = await runNoShowCron(store, { now: new Date('2026-08-24T01:30:00.000Z') });
    assert.equal(run3.sent, 1);
    assert.equal(world.jobs.length, 1);
    assert.equal(
      world.jobs[0].text,
      'Hi Thabo, we missed you tonight! We still have tables available this Saturday. Would you like to rebook?'
    );
    assert.equal(world.jobs[0].tenantId, 'tenant-a');
    assert.equal(world.jobs[0].waAccountId, 'wa-a');
    assert.equal(world.jobs[0].to, '+27811111111');
    assert.equal(row.noShowFollowupSent, true);
    assert.equal(row.noShowFollowupSentAt?.toISOString(), '2026-08-24T01:30:00.000Z');

    // Run 4 — +1h: the row is marked, so nothing is scanned and nothing is sent.
    const run4 = await runNoShowCron(store, { now: new Date('2026-08-24T02:30:00.000Z') });
    assert.equal(run4.scanned, 0);
    assert.equal(run4.sent, 0);
    assert.equal(world.jobs.length, 1);
    assert.equal(row.noShowFollowupSentAt?.toISOString(), '2026-08-24T01:30:00.000Z'); // untouched
  });

  test('a queue failure does not mark the row sent or abort the batch', async () => {
    const rows = [
      detectedRow({ id: 'r-boom', customerName: 'Boom', customerPhone: '+27855555555', contactId: 'contact-boom', conversationId: null }),
      detectedRow({ id: 'r-fine', customerName: 'Sipho', customerPhone: '+27866666666', contactId: 'contact-sipho', conversationId: null }),
    ];
    const world = fakeWorld(rows, {
      contacts: [
        { id: 'contact-boom', phone: '+27855555555', name: 'Boom', blocklisted: false },
        { id: 'contact-sipho', phone: '+27866666666', name: 'Sipho', blocklisted: false },
      ],
      conversations: [],
      failQueueFor: ['+27855555555'],
    });
    const summary = await runNoShowCron(fakeStore(world), { now: new Date('2026-08-24T01:30:00.000Z') });

    assert.equal(summary.sent, 1);
    assert.equal(summary.skipped.failed, 1);
    assert.equal(rows[0].noShowFollowupSent, false); // retried next run
    assert.equal(rows[1].noShowFollowupSent, true);
    assert.equal(world.jobs.length, 1);
    assert.match(world.jobs[0].text, /^Hi Sipho,/);
  });

  test('at most 5 sample messages are reported', async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      detectedRow({
        id: `r-${i}`,
        customerName: `Guest ${i}`,
        customerPhone: `+278${String(10000000 + i).slice(1)}`,
        contactId: null,
        conversationId: null,
      })
    );
    const world = fakeWorld(rows, { contacts: [], conversations: [] });
    const summary = await runNoShowCron(fakeStore(world), { now: new Date('2026-08-24T01:30:00.000Z') });

    assert.equal(summary.sent, 6);
    assert.equal(summary.samples.length, 5);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation: per-reservation scoping
// ---------------------------------------------------------------------------

describe('tenant isolation', () => {
  const NOW = new Date('2026-08-24T01:30:00.000Z');

  function isolationWorld() {
    const rows = [
      detectedRow({
        id: 'r-a',
        tenantId: 'tenant-a',
        customerName: 'Thabo',
        customerPhone: '+27811111111',
        contactId: 'contact-a',
        conversationId: 'conversation-a',
      }),
      detectedRow({
        id: 'r-b',
        tenantId: 'tenant-b',
        customerName: 'Amahle',
        customerPhone: '+27822222222',
        contactId: 'contact-b',
        conversationId: 'conversation-b',
      }),
      // tenant-c runs with AI switched off: its no-show is a fact the
      // restaurant can see, but no automated offer may go out.
      detectedRow({
        id: 'r-c',
        tenantId: 'tenant-c',
        customerName: 'Sipho',
        customerPhone: '+27833333333',
        contactId: 'contact-c',
        conversationId: 'conversation-c',
      }),
    ];
    return fakeWorld(rows, {
      tenants: [
        { id: 'tenant-a', connectedWaAccountId: 'wa-a' },
        { id: 'tenant-b', connectedWaAccountId: 'wa-b' },
        { id: 'tenant-c', aiEnabled: false, connectedWaAccountId: 'wa-c' },
      ],
      contacts: [
        { id: 'contact-a', phone: '+27811111111', name: 'Thabo', blocklisted: false },
        { id: 'contact-b', phone: '+27822222222', name: 'Amahle', blocklisted: false },
        { id: 'contact-c', phone: '+27833333333', name: 'Sipho', blocklisted: false },
      ],
      conversations: [
        { id: 'conversation-a', waAccountId: 'wa-a', manualTakeover: false, contactId: 'contact-a' },
        { id: 'conversation-b', waAccountId: 'wa-b', manualTakeover: false, contactId: 'contact-b' },
        { id: 'conversation-c', waAccountId: 'wa-c', manualTakeover: false, contactId: 'contact-c' },
      ],
    });
  }

  test('each follow-up is routed through its own tenant — no cross-tenant leakage', async () => {
    const world = isolationWorld();
    const summary = await runNoShowCron(fakeStore(world), { now: NOW });

    assert.equal(summary.sent, 2); // tenant-c is filtered out, not 3
    assert.equal(world.jobs.length, 2);

    // No job may reference tenant-c's tenant id, account, or customer.
    assert.ok(!world.jobs.some((j) => j.tenantId === 'tenant-c'));
    assert.ok(!world.jobs.some((j) => j.waAccountId === 'wa-c'));
    assert.ok(!world.jobs.some((j) => j.to === '+27833333333'));
    assert.equal(world.rows[2].noShowFollowupSent, false); // left unmarked

    // Every job is scoped to the reservation's own tenant: the account
    // belongs to that tenant, and the number belongs to that tenant's
    // customer. A job that mixed data across tenants would fail this.
    const accountByTenant = new Map(Array.from(world.tenants).map(([id, t]) => [id, t.connectedWaAccountId]));
    const phoneByTenant = new Map([
      ['tenant-a', '+27811111111'],
      ['tenant-b', '+27822222222'],
    ]);
    for (const job of world.jobs) {
      assert.equal(job.waAccountId, accountByTenant.get(job.tenantId), 'job used a foreign tenant account');
      assert.equal(job.to, phoneByTenant.get(job.tenantId), 'job used a foreign tenant number');
    }
    assert.deepEqual(
      world.jobs.map((j) => [j.tenantId, j.waAccountId, j.to]).sort(),
      [
        ['tenant-a', 'wa-a', '+27811111111'],
        ['tenant-b', 'wa-b', '+27822222222'],
      ]
    );
  });

  test("an AI-off tenant's no-show is still detected (a fact), but never messaged", async () => {
    const world = isolationWorld();
    // Phase 1: detection is factual and tenant-agnostic.
    const row = fakeRow({ tenantId: 'tenant-c', contactId: 'contact-c', conversationId: 'conversation-c', customerName: 'Sipho' });
    world.rows.push(row);
    const detectRun = await runNoShowCron(fakeStore(world), { now: new Date('2026-08-23T21:30:00.000Z') });
    assert.equal(detectRun.detected, 1);
    assert.equal(row.noShowDetected, true);

    // Phase 2 (2.5h after the stamp): the tenant filter keeps it out.
    const followupRun = await runNoShowCron(fakeStore(world), { now: NOW });
    assert.ok(!world.jobs.some((j) => j.tenantId === 'tenant-c'));
    assert.equal(row.noShowFollowupSent, false);
  });
});

// ---------------------------------------------------------------------------
// Safety: the audiences that must never be auto-messaged
// ---------------------------------------------------------------------------

describe('safety: opted-out, AI-off, manual-mode, manual-takeover, unreachable', () => {
  const NOW = new Date('2026-08-24T01:30:00.000Z');

  test('an opted-out contact is never messaged, and stays unmarked (POPIA)', async () => {
    const row = detectedRow({});
    const world = fakeWorld([row], {
      contacts: [{ id: 'contact-1', phone: '+27811111111', name: 'Thabo', blocklisted: true }],
    });
    const summary = await runNoShowCron(fakeStore(world), { now: NOW });

    assert.equal(summary.sent, 0);
    assert.equal(summary.scanned, 0); // filtered out of the scan itself
    assert.equal(world.jobs.length, 0);
    assert.equal(row.noShowFollowupSent, false); // offered once they re-subscribe
  });

  test('a leaked opted-out row (race between scan and message) is still not messaged', async () => {
    // No phone on the reservation either: with the contact blocklisted
    // there is no lawful destination at all.
    const row = detectedRow({ customerPhone: null });
    const world = fakeWorld([row], {
      contacts: [{ id: 'contact-1', phone: '+27811111111', name: 'Thabo', blocklisted: true }],
      leakOptOut: ['reservation-1'],
    });
    const summary = await runNoShowCron(fakeStore(world), { now: NOW });

    assert.equal(summary.scanned, 1);
    assert.equal(summary.skipped.noRecipient, 1); // findRecipient re-checks blocklisted
    assert.equal(world.jobs.length, 0);
    assert.equal(row.noShowFollowupSent, false);
  });

  test('a tenant with AI switched off is never messaged', async () => {
    const row = detectedRow({});
    const world = fakeWorld([row], {
      tenants: [{ id: 'tenant-a', aiEnabled: false, connectedWaAccountId: 'wa-a' }],
    });
    const summary = await runNoShowCron(fakeStore(world), { now: NOW });

    assert.equal(summary.sent, 0);
    assert.equal(summary.scanned, 0);
    assert.equal(row.noShowFollowupSent, false);
  });

  test('a tenant in manual mode is never messaged', async () => {
    const row = detectedRow({});
    const world = fakeWorld([row], {
      tenants: [{ id: 'tenant-a', manualMode: true, connectedWaAccountId: 'wa-a' }],
    });
    const summary = await runNoShowCron(fakeStore(world), { now: NOW });

    assert.equal(summary.sent, 0);
    assert.equal(summary.scanned, 0);
    assert.equal(row.noShowFollowupSent, false);
  });

  test('a leaked manual-takeover row (race between scan and message) is bowed out of', async () => {
    const row = detectedRow({});
    const world = fakeWorld([row], {
      conversations: [{ id: 'conversation-1', waAccountId: 'wa-a', manualTakeover: true, contactId: 'contact-1' }],
      leakTakeover: ['reservation-1'],
    });
    const summary = await runNoShowCron(fakeStore(world), { now: NOW });

    assert.equal(summary.scanned, 1);
    assert.equal(summary.skipped.manualTakeover, 1);
    assert.equal(world.jobs.length, 0);
    assert.equal(row.noShowFollowupSent, false); // offered once staff releases the thread
  });

  test('an unreachable customer stays unmarked, and is offered once the route exists', async () => {
    const row = detectedRow({ contactId: null, conversationId: null, customerPhone: '+27844444444', customerName: 'Lerato' });
    const world = fakeWorld([row], {
      tenants: [{ id: 'tenant-a', connectedWaAccountId: null }],
      contacts: [],
      conversations: [],
    });
    const store = fakeStore(world);

    // No connected WhatsApp account: no recipient, left unmarked.
    const run1 = await runNoShowCron(store, { now: NOW });
    assert.equal(run1.sent, 0);
    assert.equal(run1.skipped.noRecipient, 1);
    assert.equal(world.jobs.length, 0);
    assert.equal(row.noShowFollowupSent, false);

    // WhatsApp reconnects: the next run delivers the offer.
    world.tenants.get('tenant-a')!.connectedWaAccountId = 'wa-a';
    const run2 = await runNoShowCron(store, { now: new Date(NOW.getTime() + HOUR) });
    assert.equal(run2.sent, 1);
    assert.equal(world.jobs.length, 1);
    assert.equal(world.jobs[0].to, '+27844444444');
    assert.match(world.jobs[0].text, /^Hi Lerato, we missed you tonight!/);
    assert.equal(row.noShowFollowupSent, true);
  });
});
