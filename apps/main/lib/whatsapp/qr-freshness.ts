/**
 * Pure client-side policy for keeping the WhatsApp linking QR SCANNABLE.
 *
 * Extracted from the dashboard connection page so the freshness
 * behaviour is unit-testable. The production defect (2026-08-31): the
 * operator can legitimately pause QR refreshes — socket restart, Render
 * redeploy, backoff window — and the page kept rendering the LAST
 * stored code, which the phone then rejected as expired. The page now
 * derives its phase from how long ago the code actually CHANGED, and
 * re-kicks the operator (rate-limited) when it goes stale.
 *
 * No React, no fetch, no timers in here — decisions only.
 */

/** A stored Baileys QR is dead after this long without a value change. */
export const QR_STALE_AFTER_MS = 40_000;

/** Minimum spacing between automatic /api/whatsapp/connect re-kicks. */
export const MIN_KICK_INTERVAL_MS = 30_000;

/** Give up auto-recovering after this many kicks; surface manual retry. */
export const MAX_AUTO_KICKS = 8;

export type QrPhase =
  | 'connected'
  | 'fresh'
  | 'waiting'
  | 'stale';

export interface QrPhaseInput {
  isConnected: boolean;
  qrCode: string | null;
  /** Client timestamp (ms) of the last time the qrCode VALUE changed. */
  lastQrChangeAt: number | null;
  now: number;
  staleAfterMs?: number;
}

export function qrPhase(input: QrPhaseInput): QrPhase {
  if (input.isConnected) return 'connected';
  if (!input.qrCode) return 'waiting';

  // First time we see a code, treat it as fresh — the clock starts now.
  if (input.lastQrChangeAt === null) return 'fresh';

  const staleAfter = input.staleAfterMs ?? QR_STALE_AFTER_MS;
  return input.now - input.lastQrChangeAt > staleAfter ? 'stale' : 'fresh';
}

export interface AutoKickInput {
  phase: QrPhase;
  /** Client timestamp (ms) of the last kick, null if never kicked. */
  lastKickAt: number | null;
  kicks: number;
  now: number;
  minIntervalMs?: number;
  maxKicks?: number;
}

/**
 * Should the page fire (or schedule) a POST /api/whatsapp/connect?
 *
 * - 'stale': the displayed code is expired — the core recovery path.
 * - 'waiting': no code at all yet (first load, or operator restarting).
 *   Kicking here is what makes the page AUTO-START the linking flow.
 * - 'fresh' / 'connected': never kick — the operator is healthy and a
 *   kick would needlessly churn the socket.
 *
 * Rate-limited to MIN_KICK_INTERVAL_MS and capped at MAX_AUTO_KICKS so
 * a hard-down operator can't turn the tab into a request loop; after
 * the cap the page stops and shows the manual retry control.
 */
export function shouldAutoKick(input: AutoKickInput): boolean {
  if (input.phase === 'fresh' || input.phase === 'connected') return false;

  const maxKicks = input.maxKicks ?? MAX_AUTO_KICKS;
  if (input.kicks >= maxKicks) return false;

  const minInterval = input.minIntervalMs ?? MIN_KICK_INTERVAL_MS;
  if (input.lastKickAt !== null && input.now - input.lastKickAt < minInterval) {
    return false;
  }
  return true;
}
