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
 * Round 2 (2026-08-31, evening): the "Starting the WhatsApp engine…"
 * forever freeze. Two more decisions extracted here so they are
 * testable:
 *
 *   - Kicks must fire even when the STATUS poll itself fails. The page
 *     used to gate its auto-kick effect on `status !== null`; a 401/500
 *     from /api/whatsapp/status meant zero kicks, zero errors, and a
 *     spinner that never stopped. `pollAttempted` (default true, so
 *     historical callers keep kicking) now expresses "one fetch cycle
 *     has happened" instead of "one fetch SUCCEEDED".
 *
 *   - Engine errors must SURVIVE routine status polls. The page used to
 *     clear its error box on every successful poll — i.e. within 3s of
 *     a failed kick, before any human could read it.
 *     shouldClearEngineError() says when an error may finally go away:
 *     state improved (a QR arrived / connection opened), or a TTL
 *     passed, or a later kick succeeded.
 *
 * No React, no fetch, no timers in here — decisions only.
 */

/** A stored Baileys QR is dead after this long without a value change. */
export const QR_STALE_AFTER_MS = 40_000;

/** Minimum spacing between automatic /api/whatsapp/connect re-kicks. */
export const MIN_KICK_INTERVAL_MS = 30_000;

/** Give up auto-recovering after this many kicks; surface manual retry. */
export const MAX_AUTO_KICKS = 8;

/** An engine error lingers at least this long (or until state improves). */
export const ENGINE_ERROR_TTL_MS = 60_000;

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
  /**
   * Has at least ONE /api/whatsapp/status fetch cycle completed —
   * successfully OR NOT? The page's old gate was `status !== null`,
   * which conflated "the poll happened" with "the poll succeeded": a
   * 401/500 from the status route meant no kick would ever fire while
   * the UI spun on "Starting the WhatsApp engine…". Defaults to true so
   * existing callers (and their tests) keep the historic behaviour.
   */
  pollAttempted?: boolean;
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
 *   Kicking here is what makes the page AUTO-START the linking flow —
 *   and, since round 2, this fires even when the status poll itself is
 *   failing, so a broken status route surfaces as a kick error instead
 *   of an infinite silent spinner.
 * - 'fresh' / 'connected': never kick — the operator is healthy and a
 *   kick would needlessly churn the socket.
 *
 * Rate-limited to MIN_KICK_INTERVAL_MS and capped at MAX_AUTO_KICKS so
 * a hard-down operator can't turn the tab into a request loop; after
 * the cap the page stops and shows the manual retry control.
 */
export function shouldAutoKick(input: AutoKickInput): boolean {
  if (input.phase === 'fresh' || input.phase === 'connected') return false;
  if (input.pollAttempted === false) return false;

  const maxKicks = input.maxKicks ?? MAX_AUTO_KICKS;
  if (input.kicks >= maxKicks) return false;

  const minInterval = input.minIntervalMs ?? MIN_KICK_INTERVAL_MS;
  if (input.lastKickAt !== null && input.now - input.lastKickAt < minInterval) {
    return false;
  }
  return true;
}

export interface EngineErrorClearInput {
  /** Client timestamp (ms) of the currently shown engine error, if any. */
  engineErrorAt: number | null;
  /**
   * True when the linking state has materially improved since the error
   * was raised — a QR code arrived, or the account connected. Errors
   * must not survive a recovery they no longer describe.
   */
  stateImproved: boolean;
  now: number;
  ttlMs?: number;
}

/**
 * May the page finally drop its engine error panel?
 *
 * The round-2 defect: refresh() cleared `error` on EVERY successful
 * status poll, i.e. ~3 s after any failed kick — the exact error that
 * explained the stuck "Starting the WhatsApp engine…" (operator 401,
 * unreachable host, unset OPERATOR_URL) vanished before a human could
 * read it. An error now persists until the linking state actually
 * improves, a later kick succeeds (the page clears it there), or the
 * TTL expires so a stale message cannot linger beside a healthy flow.
 */
export function shouldClearEngineError(input: EngineErrorClearInput): boolean {
  if (input.stateImproved) return true;
  if (input.engineErrorAt === null) return true;
  const ttl = input.ttlMs ?? ENGINE_ERROR_TTL_MS;
  return input.now - input.engineErrorAt > ttl;
}
