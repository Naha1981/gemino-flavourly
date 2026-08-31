import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextReconnectDelayMs,
  isZombieLinkingSocket,
  LINKING_MAX_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  QR_STALE_MS,
} from '../dist/whatsapp/linking-policy.js';

const NOW = new Date('2026-08-31T06:08:17.000Z');

describe('nextReconnectDelayMs — linking vs linked backoff caps', () => {
  test('linked accounts keep the long exponential backoff series', () => {
    assert.equal(nextReconnectDelayMs(1, true), 5_000);
    assert.equal(nextReconnectDelayMs(2, true), 10_000);
    assert.equal(nextReconnectDelayMs(3, true), 20_000);
    assert.equal(nextReconnectDelayMs(4, true), 40_000);
    assert.equal(nextReconnectDelayMs(5, true), 80_000);
    assert.equal(nextReconnectDelayMs(8, true), MAX_RECONNECT_DELAY_MS);
  });

  test('LINKING accounts cap at 15s so the human at the QR screen is not abandoned', () => {
    // This is the production defect: attempt 5+ for a never-linked
    // account previously backed off 80s → 5min while the user watched an
    // expired QR.
    assert.equal(nextReconnectDelayMs(5, false), LINKING_MAX_RECONNECT_DELAY_MS);
    assert.equal(nextReconnectDelayMs(20, false), LINKING_MAX_RECONNECT_DELAY_MS);
    // Early attempts still respect the fast path.
    assert.equal(nextReconnectDelayMs(1, false), 5_000);
    assert.equal(nextReconnectDelayMs(2, false), 10_000);
  });

  test('non-positive attempts are clamped to the first step, not NaN', () => {
    assert.equal(nextReconnectDelayMs(0, true), 5_000);
    assert.equal(nextReconnectDelayMs(-3, false), 5_000);
  });
});

describe('isZombieLinkingSocket — /start eviction policy', () => {
  const base = {
    socketRegistered: true,
    open: false,
    linked: false,
    qrCode: '2@Ombc2CynBaslTeo46zHKHN',
    qrUpdatedAt: NOW,
    now: NOW,
  };

  test('a healthy linking socket with a freshly written QR is NOT a zombie', () => {
    assert.equal(isZombieLinkingSocket(base), false);
  });

  test('exactly the production freeze: QR written once, then silence past the staleness window', () => {
    // updated_at frozen at 06:08:17, now = 06:09:17 (60s later) — the
    // observed live row on 2026-08-31.
    assert.equal(
      isZombieLinkingSocket({ ...base, now: new Date(NOW.getTime() + 60_000) }),
      true
    );
  });

  test('just inside the window is still tolerated (Baileys re-emits ~20s)', () => {
    assert.equal(
      isZombieLinkingSocket({ ...base, now: new Date(NOW.getTime() + QR_STALE_MS - 1_000) }),
      false
    );
  });

  test('qr cleared and never re-written past the window is a zombie', () => {
    assert.equal(
      isZombieLinkingSocket({
        ...base,
        qrCode: null,
        now: new Date(NOW.getTime() + QR_STALE_MS + 5_000),
      }),
      true
    );
  });

  test('qr cleared RECENTLY is not a zombie (reconnect is in flight)', () => {
    assert.equal(
      isZombieLinkingSocket({ ...base, qrCode: null, now: new Date(NOW.getTime() + 10_000) }),
      false
    );
  });

  test('a socket with no row write and no stored QR is a zombie', () => {
    assert.equal(
      isZombieLinkingSocket({ ...base, qrCode: null, qrUpdatedAt: null }),
      true
    );
  });

  test('NEVER evict: open socket, linked session, or unregistered account', () => {
    assert.equal(isZombieLinkingSocket({ ...base, open: true }), false);
    assert.equal(
      isZombieLinkingSocket({ ...base, linked: true, now: new Date(NOW.getTime() + 10 * 60_000) }),
      false
    );
    assert.equal(
      isZombieLinkingSocket({ ...base, socketRegistered: false, now: new Date(NOW.getTime() + 10 * 60_000) }),
      false
    );
  });
});
