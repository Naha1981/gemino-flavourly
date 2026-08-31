import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  qrPhase,
  shouldAutoKick,
  QR_STALE_AFTER_MS,
  MIN_KICK_INTERVAL_MS,
  MAX_AUTO_KICKS,
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
});
