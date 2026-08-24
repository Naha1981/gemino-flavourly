/**
 * Outbound WhatsApp dispatch decisions.
 *
 * Extracted so the "can this message actually be delivered?" question has
 * exactly one answer, testable without a database or a live operator.
 *
 * The bug this exists to prevent
 * -----------------------------
 * The manual-reply route wrapped BOTH the direct send and the outbox
 * fallback in `if (convo.waAccountId)`. `conversations.wa_account_id` is
 * nullable (`onDelete: 'set null'`), so when it was NULL the route
 * inserted the message row, attempted nothing, queued nothing, and still
 * returned `{ ok: true }`. Staff saw their reply in the thread; the
 * customer never received it. No error, no log, no retry — a silently
 * dropped message.
 *
 * Treating "no route to the customer" as success is the specific failure
 * mode this module makes impossible.
 */

/** Terminal-ish state of an outbound message, mirrored on the message row. */
export type DeliveryStatus = 'queued' | 'sent' | 'failed';

export interface DispatchOutcome {
  /** What to persist on the message row. */
  status: DeliveryStatus;
  /** Operator/queue error, safe to show staff. Never a secret. */
  error?: string;
  /** True only when the customer's message is genuinely on its way. */
  accepted: boolean;
}

/**
 * Reason a message could not be dispatched at all, independent of any
 * network call. Returns null when dispatch may proceed.
 *
 * Kept separate from the I/O so the precondition can be asserted directly.
 */
export function findDispatchBlocker(waAccountId: string | null | undefined): string | null {
  if (typeof waAccountId !== 'string' || waAccountId.trim() === '') {
    // No WhatsApp account is linked to this conversation, so there is no
    // channel to send on. Queueing would be pointless: the outbox job
    // would need the same missing id and could only fail repeatedly.
    return 'This conversation has no connected WhatsApp account, so the reply could not be sent. Reconnect WhatsApp in Settings, then resend.';
  }
  return null;
}

/**
 * Resolves the outcome of an attempted dispatch into the state to persist.
 *
 * `directSendSucceeded` is the operator's real answer, not an assumption:
 * operatorClient.sendMessage() never throws — every failure is returned as
 * `{ success: false }` — so a try/catch around it catches nothing and
 * silently reports success. Callers must pass the actual result.
 */
export function resolveDispatchOutcome(args: {
  blocker: string | null;
  directSendSucceeded: boolean;
  queuedForRetry: boolean;
  error?: string;
}): DispatchOutcome {
  const { blocker, directSendSucceeded, queuedForRetry, error } = args;

  // Nothing could be attempted: fail immediately and visibly.
  if (blocker) {
    return { status: 'failed', error: blocker, accepted: false };
  }

  if (directSendSucceeded) {
    return { status: 'sent', accepted: true };
  }

  // The direct send failed but the outbox will retry it. This is a
  // legitimate success from the caller's perspective — delivery is still
  // pending, not lost — so it is 'queued', never 'sent'.
  if (queuedForRetry) {
    return { status: 'queued', error, accepted: true };
  }

  // Direct send failed AND nothing was queued: the message is lost.
  return {
    status: 'failed',
    error: error ?? 'The message could not be sent and could not be queued for retry.',
    accepted: false,
  };
}

/**
 * HTTP status for a dispatch outcome.
 *
 * A message that was never dispatched must NOT return 200 — that is
 * exactly what made the original bug invisible to the UI.
 */
export function dispatchHttpStatus(outcome: DispatchOutcome): number {
  return outcome.accepted ? 200 : 502;
}
