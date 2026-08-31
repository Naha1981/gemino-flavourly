import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  qrPhase,
  shouldAutoKick,
  shouldClearEngineError,
  QR_STALE_AFTER_MS,
  MIN_KICK_INTERVAL_MS,
  MAX_AUTO_KICKS,
  ENGINE_ERROR_TTL_MS,
} from './qr-freshness.ts';

describe('qrPhase — display state for the linking code', () => {
  test('connected wins over everything', () => {
    assert.equal(
      qrPhase({ isConnected: true, qrCode: '2@abc', lastQrChangeAt: 0, now: 10_000_000 }),
      'connected'
    );
  });

  test('no code yet → waiting', () => {
    assert.equal(qrPhase({ isConnected: false, qrCode: null, lastQrChangeAt: null, now: 1_000 }), 'waiting');
  });

  test('first sight of a code → fresh (clock starts now)', () => {
    assert.equal(qrPhase({ isConnected: false, qrCode: '2@abc', lastQrChangeAt: null, now: 1_000 }), 'fresh');
  });

  test('code changed recently → fresh', () => {
    assert.equal(
      qrPhase({ isConnected: false, qrCode: '2@abc', lastQrChangeAt: 1_000, now: 1_000 + 20_000 }),
      'fresh'
    );
  });

  test('exactly the production defect: value frozen past the window → stale', () => {
    assert.equal(
      qrPhase({ isConnected: false, qrCode: '2@abc', lastQrChangeAt: 1_000, now: 1_000 + QR_STALE_AFTER_MS + 1 }),
      'stale'
    );
  });

  test('boundary: one millisecond inside the window is still fresh', () => {
    assert.equal(
      qrPhase({ isConnected: false, qrCode: '2@abc', lastQrChangeAt: 1_000, now: 1_000 + QR_STALE_AFTER_MS }),
      'fresh'
    );
  });
});

describe('shouldAutoKick — operator re-kick policy', () => {
  test('fresh and connected phases never kick (healthy operator)', () => {
    assert.equal(shouldAutoKick({ phase: 'fresh', lastKickAt: null, kicks: 0, now: 0 }), false);
    assert.equal(shouldAutoKick({ phase: 'connected', lastKickAt: null, kicks: 0, now: 0 }), false);
  });

  test('stale phase kicks — this is the recovery path for the frozen QR', () => {
    assert.equal(shouldAutoKick({ phase: 'stale', lastKickAt: null, kicks: 0, now: 0 }), true);
  });

  test('waiting phase kicks on first load — the page auto-starts linking', () => {
    assert.equal(shouldAutoKick({ phase: 'waiting', lastKickAt: null, kicks: 0, now: 0 }), true);
  });

  test('rate-limited: no second kick inside the minimum interval', () => {
    assert.equal(
      shouldAutoKick({ phase: 'stale', lastKickAt: 100_000, kicks: 3, now: 100_000 + MIN_KICK_INTERVAL_MS - 1 }),
      false
    );
    assert.equal(
      shouldAutoKick({ phase: 'stale', lastKickAt: 100_000, kicks: 3, now: 100_000 + MIN_KICK_INTERVAL_MS }),
      true
    );
  });

  test('capped: stops hammering a hard-down operator and defers to the human', () => {
    assert.equal(
      shouldAutoKick({ phase: 'stale', lastKickAt: 0, kicks: MAX_AUTO_KICKS, now: 10 * 60_000 }),
      false
    );
  });

  test('custom bounds are respected (test seam)', () => {
    assert.equal(
      shouldAutoKick({ phase: 'waiting', lastKickAt: 1_000, kicks: 0, now: 2_000, minIntervalMs: 10_000 }),
      false
    );
  });

  test('round 2: kicks fire when the status poll FAILED (pollAttempted true)', () => {
    // The "Starting the WhatsApp engine…" forever freeze: a 401/500 from
    // /api/whatsapp/status must not stop the page from kicking — the
    // kick's error then names the real problem.
    assert.equal(
      shouldAutoKick({ phase: 'waiting', pollAttempted: true, lastKickAt: null, kicks: 0, now: 0 }),
      true
    );
  });

  test('round 2: no kick before ANY poll cycle completed (pollAttempted false)', () => {
    assert.equal(
      shouldAutoKick({ phase: 'waiting', pollAttempted: false, lastKickAt: null, kicks: 0, now: 0 }),
      false
    );
  });

  test('round 2: pollAttempted defaults to true (historic callers unchanged)', () => {
    assert.equal(shouldAutoKick({ phase: 'stale', lastKickAt: null, kicks: 0, now: 0 }), true);
  });
});

describe('shouldClearEngineError — engine error persistence (round 2)', () => {
  test('no error recorded → nothing to clear (true is a no-op)', () => {
    assert.equal(shouldClearEngineError({ engineErrorAt: null, stateImproved: false, now: 1_000 }), true);
  });

  test('the production defect: a fresh error must NOT be cleared by the 3s status poll', () => {
    // Old behaviour: refresh() cleared `error` on any successful poll —
    // i.e. 3s after a failed kick, before a human could read it.
    assert.equal(
      shouldClearEngineError({ engineErrorAt: 100_000, stateImproved: false, now: 100_000 + 3_000 }),
      false
    );
  });

  test('state improved (QR arrived / connected) → error goes immediately', () => {
    assert.equal(
      shouldClearEngineError({ engineErrorAt: 100_000, stateImproved: true, now: 100_000 + 1 }),
      true
    );
  });

  test('error expires after the TTL so it cannot linger beside a healthy flow', () => {
    assert.equal(
      shouldClearEngineError({
        engineErrorAt: 100_000,
        stateImproved: false,
        now: 100_000 + ENGINE_ERROR_TTL_MS + 1,
      }),
      true
    );
  });

  test('boundary: exactly the TTL is not yet expired', () => {
    assert.equal(
      shouldClearEngineError({ engineErrorAt: 100_000, stateImproved: false, now: 100_000 + ENGINE_ERROR_TTL_MS }),
      false
    );
  });

  test('custom TTL seam is respected', () => {
    assert.equal(
      shouldClearEngineError({ engineErrorAt: 0, stateImproved: false, now: 5_000, ttlMs: 10_000 }),
      false
    );
    assert.equal(
      shouldClearEngineError({ engineErrorAt: 0, stateImproved: false, now: 10_001, ttlMs: 10_000 }),
      true
    );
  });
});
