import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEligibleForReviewRequest,
  buildGoogleReviewLink,
  generateReviewRequestMessage,
  REVIEW_REQUEST_DELAY_HOURS,
  type ReviewRequestReservation,
} from './review-request.ts';
import { runReviewRequestCron, type ReviewRequestStore } from './review-request-cron.ts';

// ---------------------------------------------------------------------------
// Unit: eligibility + message copy
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-20T21:00:00Z'); // 21:00 — dinner long done

function booking(overrides: Partial<ReviewRequestReservation> = {}): ReviewRequestReservation {
  return {
    id: 'res-1',
    tenantId: 't1',
    customerName: 'Thabo',
    customerPhone: '+27821110000',
    date: new Date(NOW.getTime() - 3 * 60 * 60 * 1000), // dined 18:00
    status: 'confirmed',
    reviewRequestSent: false,
    conversationId: null,
    blocklisted: false,
    ...overrides,
  };
}

describe('isEligibleForReviewRequest (Gate #13 window)', () => {
  test('a confirmed booking 2+ hours ago is eligible', () => {
    assert.ok(isEligibleForReviewRequest(booking(), NOW));
  });

  test('exactly 2 hours ago is eligible; 1:59 is not', () => {
    const twoHours = booking({ date: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) });
    const justUnder = booking({ date: new Date(NOW.getTime() - (2 * 60 * 60 * 1000 - 60_000)) });
    assert.ok(isEligibleForReviewRequest(twoHours, NOW));
    assert.ok(!isEligibleForReviewRequest(justUnder, NOW));
  });

  test('future bookings are never eligible', () => {
    assert.ok(!isEligibleForReviewRequest(booking({ date: new Date(NOW.getTime() + 60_000) }), NOW));
  });

  test('bookings older than 26 hours are stale and skipped', () => {
    const stale = booking({ date: new Date(NOW.getTime() - 27 * 60 * 60 * 1000) });
    const edge = booking({ date: new Date(NOW.getTime() - 26 * 60 * 60 * 1000) });
    assert.ok(!isEligibleForReviewRequest(stale, NOW));
    assert.ok(isEligibleForReviewRequest(edge, NOW));
  });

  test('the 26h window catches yesterday evenings dinner after midnight', () => {
    const midnight = new Date('2026-08-21T00:30:00Z');
    const lastNightDinner = booking({ date: new Date('2026-08-20T22:00:00Z') }); // 2.5h ago
    assert.ok(isEligibleForReviewRequest(lastNightDinner, midnight));
  });

  test('already-asked bookings are never asked again', () => {
    assert.ok(!isEligibleForReviewRequest(booking({ reviewRequestSent: true }), NOW));
  });

  test('cancelled and no-show bookings never get asked', () => {
    assert.ok(!isEligibleForReviewRequest(booking({ status: 'cancelled' }), NOW));
    assert.ok(!isEligibleForReviewRequest(booking({ status: 'no_show' }), NOW));
  });

  test('completed bookings DO get asked (staff confirmed they dined)', () => {
    assert.ok(isEligibleForReviewRequest(booking({ status: 'completed' }), NOW));
  });
});

describe('review request copy', () => {
  test('the link opens the Google review composer with the place id encoded', () => {
    assert.equal(
      buildGoogleReviewLink('ChIJN1t_tDeuEmsRUsoyG83frY4'),
      'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4'
    );
  });

  test('message greets by name and carries the link', () => {
    const text = generateReviewRequestMessage('Thabo', 'https://search.google.com/local/writereview?placeid=X');
    assert.match(text, /^Hi Thabo, thank you for dining with us tonight!/);
    assert.ok(text.includes('https://search.google.com/local/writereview?placeid=X'));
  });

  test('missing name degrades to a generic greeting', () => {
    assert.match(generateReviewRequestMessage(null, 'L'), /^Hi there,/);
    assert.match(generateReviewRequestMessage('   ', 'L'), /^Hi there,/);
  });

  test('delay constant matches the gate contract (2 hours)', () => {
    assert.equal(REVIEW_REQUEST_DELAY_HOURS, 2);
  });
});

// ---------------------------------------------------------------------------
// Integration: the cron runner with an in-memory store (incl. POPIA)
// ---------------------------------------------------------------------------

function memoryStore(overrides: Partial<ReviewRequestStore> = {}) {
  const state = {
    queued: [] as Array<{ tenantId: string; to: string; text: string }>,
    stamped: [] as Array<{ reservationId: string; at: Date }>,
  };
  const store: ReviewRequestStore & { state: typeof state } = {
    state,
    async findTenants() {
      return [{ id: 't1', name: 'Bistro', aiEnabled: true, manualMode: false }];
    },
    async getPlaceId() {
      return 'place-1';
    },
    async getEligibleReservations(tenantId) {
      return [
        booking({ tenantId }),
        booking({ id: 'res-2', tenantId, customerPhone: '+27829999999', blocklisted: true }),
      ];
    },
    async isManualTakeover() {
      return false;
    },
    async queueMessage(input) {
      state.queued.push({ tenantId: input.tenantId, to: input.to, text: input.text });
    },
    async resolveSender() {
      return { waAccountId: 'wa-1' };
    },
    async markRequestSent(reservationId, _tenantId, at) {
      state.stamped.push({ reservationId, at });
      return true;
    },
    ...overrides,
  };
  return store;
}

describe('runReviewRequestCron (integration semantics)', () => {
  test('happy path: queues the ask via the outbox and stamps the booking', async () => {
    const store = memoryStore();
    const summary = await runReviewRequestCron(store, { now: NOW });

    assert.equal(summary.sent, 1);
    assert.equal(store.state.queued.length, 1);
    assert.equal(store.state.queued[0].to, '+27821110000');
    assert.match(store.state.queued[0].text, /thank you for dining with us tonight/i);
    assert.match(store.state.queued[0].text, /placeid=place-1/);
    assert.deepEqual(store.state.stamped.map((s) => s.reservationId), ['res-1']);
    assert.equal(summary.samples.length, 1);
  });

  test('POPIA: blocklisted (opted-out) contacts are never messaged', async () => {
    const store = memoryStore();
    const summary = await runReviewRequestCron(store, { now: NOW });
    assert.equal(summary.skipped.optedOut, 1);
    assert.equal(summary.sent, 1);
    assert.ok(store.state.queued.every((q) => q.to !== '+27829999999'));
  });

  test('tenant with AI disabled or manual mode is skipped entirely', async () => {
    const store = memoryStore({
      findTenants: async () => [{ id: 't1', name: 'B', aiEnabled: false, manualMode: false }],
    });
    const summary = await runReviewRequestCron(store, { now: NOW });
    assert.equal(summary.skipped.tenantDisabled, 1);
    assert.equal(summary.sent, 0);

    const manual = memoryStore({
      findTenants: async () => [{ id: 't1', name: 'B', aiEnabled: true, manualMode: true }],
    });
    assert.equal((await runReviewRequestCron(manual, { now: NOW })).skipped.tenantDisabled, 1);
  });

  test('no Google Places config -> no link -> tenant skipped (no dead-end asks)', async () => {
    const store = memoryStore({ getPlaceId: async () => null });
    const summary = await runReviewRequestCron(store, { now: NOW });
    assert.equal(summary.skipped.noPlaceConfig, 1);
    assert.equal(store.state.queued.length, 0);
  });

  test('manual takeover on the booking thread suppresses the ask', async () => {
    const store = memoryStore({
      getEligibleReservations: async (tenantId) => [booking({ tenantId, conversationId: 'conv-1' })],
      isManualTakeover: async () => true,
    });
    const summary = await runReviewRequestCron(store, { now: NOW });
    assert.equal(summary.skipped.manualTakeover, 1);
    assert.equal(summary.sent, 0);
  });

  test('no connected WhatsApp account skips the tenant without failing', async () => {
    const store = memoryStore({ resolveSender: async () => null });
    const summary = await runReviewRequestCron(store, { now: NOW });
    assert.equal(summary.skipped.noSender, 2); // both candidates counted
    assert.equal(summary.sent, 0);
  });

  test('a queue failure leaves the booking unstamped for the next hourly run', async () => {
    const store = memoryStore({
      queueMessage: async () => {
        throw new Error('outbox down');
      },
    });
    const summary = await runReviewRequestCron(store, { now: NOW });
    assert.equal(summary.skipped.failed, 1);
    assert.equal(store.state.stamped.length, 0); // retried next hour
  });

  test('a concurrent stamp race is flagged, not double-counted as sent', async () => {
    const store = memoryStore({
      markRequestSent: async () => false,
    });
    const summary = await runReviewRequestCron(store, { now: NOW });
    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped.failed, 1);
  });

  test('the runner re-verifies eligibility even if the store returns stale rows', async () => {
    const store = memoryStore({
      getEligibleReservations: async (tenantId) => [
        booking({ tenantId }),
        booking({ id: 'too-old', tenantId, date: new Date(NOW.getTime() - 48 * 60 * 60 * 1000) }),
      ],
    });
    const summary = await runReviewRequestCron(store, { now: NOW });
    assert.equal(summary.skipped.notEligible, 1);
    assert.equal(summary.sent, 1);
  });

  test('rows returned for the wrong tenant are refused', async () => {
    const store = memoryStore({
      getEligibleReservations: async () => [booking({ tenantId: 'other-tenant' })],
    });
    const summary = await runReviewRequestCron(store, { now: NOW });
    assert.equal(summary.skipped.failed, 1);
    assert.equal(store.state.queued.length, 0);
  });

  test('the per-run limit caps sends', async () => {
    const store = memoryStore();
    const summary = await runReviewRequestCron(store, { now: NOW, limit: 1 });
    assert.equal(summary.sent, 1);
  });
});
