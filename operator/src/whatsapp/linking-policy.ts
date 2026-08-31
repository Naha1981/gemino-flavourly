/**
 * Pure decision functions for the WhatsApp QR LINKING flow.
 *
 * Extracted from index.ts so the failure modes observed in production on
 * 2026-08-31 (see docs/gate-reports/2026-08-31-gate-qr-and-demo.md) are
 * unit-testable without a live Baileys socket:
 *
 *   - An account sitting in the QR-linking phase (never linked, no valid
 *     session) used to inherit the 5-minute reconnect backoff cap meant
 *     for CONNECTED accounts. A user standing at the connection screen
 *     with their phone out then stared at an expired QR for up to five
 *     minutes — the operator never came back to generate a fresh one.
 *
 *   - A registered-but-silent socket ("zombie": mid-handshake forever,
 *     no QR re-emission) used to make every subsequent /start WAIT for
 *     it instead of replacing it, so the DB row froze on one stale QR
 *     string that the dashboard kept displaying as scannable.
 *
 * These functions are decision-only: no socket, no DB, no timers.
 */

/** Backoff cap for accounts that HAD a working session (transient drop). */
export const MAX_RECONNECT_DELAY_MS = 5 * 60_000;

/**
 * Backoff cap while LINKING (never connected). Someone is actively
 * watching the connection screen — a long backoff here is a dead UX, and
 * Baileys QRs expire in ~20s anyway, so retrying faster than that is
 * pointless too.
 */
export const LINKING_MAX_RECONNECT_DELAY_MS = 15_000;

/**
 * Reconnect delay after `attempts` consecutive failures.
 *
 * Base series 5s, 10s, 20s, 40s… capped at MAX_RECONNECT_DELAY_MS for
 * linked accounts (resume is automatic, patience is fine) and at
 * LINKING_MAX_RECONNECT_DELAY_MS for linking accounts (a human is
 * waiting; come back before they give up).
 */
export function nextReconnectDelayMs(attempts: number, linked: boolean): number {
  const n = Math.max(1, Math.floor(attempts));
  const raw = 5_000 * 2 ** (n - 1);
  const cap = linked ? MAX_RECONNECT_DELAY_MS : LINKING_MAX_RECONNECT_DELAY_MS;
  return Math.min(raw, cap);
}

/** A stored QR older than this is considered dead (Baileys re-emits ~20s). */
export const QR_STALE_MS = 45_000;

export interface ZombieLinkingCheck {
  /** A socket object is registered for this account right now. */
  socketRegistered: boolean;
  /** The registered socket completed its handshake ('connection' open). */
  open: boolean;
  /**
   * True when the account HAS (or had) a linked session — resume flows.
   * False while it has never linked (QR pairing phase).
   */
  linked: boolean;
  /** QR string currently stored on the wa_accounts row, if any. */
  qrCode: string | null;
  /** When that row was last written by the operator. */
  qrUpdatedAt: Date | null;
  now: Date;
}

/**
 * Should /start EVICT the registered socket and build a fresh one?
 *
 * Eviction is only for the LINKING phase: a registered socket that has
 * not opened and whose account row shows no QR activity for QR_STALE_MS
 * is a zombie — waiting for it (the old behaviour) froze the pairing
 * flow on one expired code. A linked/mid-resume socket is never evicted
 * here: session resume legitimately takes seconds and tearing it down
 * would discard live Signal credentials.
 */
export function isZombieLinkingSocket(check: ZombieLinkingCheck): boolean {
  if (!check.socketRegistered) return false;
  if (check.open) return false;
  if (check.linked) return false;

  const lastWrite = check.qrUpdatedAt?.getTime() ?? null;
  if (lastWrite === null) {
    // Row never written since the socket registered — if it also holds
    // no QR, there is nothing worth waiting for.
    return check.qrCode === null;
  }
  if (check.qrCode === null || check.qrCode === '') {
    // QR was cleared (e.g. close handler) but nothing new landed within
    // the staleness window — the socket is not delivering.
    return check.now.getTime() - lastWrite > QR_STALE_MS;
  }
  return check.now.getTime() - lastWrite > QR_STALE_MS;
}
