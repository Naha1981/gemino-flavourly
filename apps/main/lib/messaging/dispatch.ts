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

/**
 * The honest, exhaustive set of outbound delivery states (PRD contract:
 * Queued → Sent → Delivered → Failed → Unknown, "never fake green ticks").
 *
 * - queued    -> accepted into the outbox, not yet dispatched
 * - sent      -> the operator confirmed DISPATCH to WhatsApp. This is NOT a
 *                delivery confirmation: the customer's phone may not have
 *                received it yet. Rendered with a single tick, never a
 *                double-tick.
 * - delivered -> we have a REAL delivery receipt (read/routed confirmation).
 *                Only ever set with an explicit `deliveryConfirmed: true`;
 *                never assumed from a successful dispatch.
 * - failed    -> retries exhausted, or no dispatch route existed
 * - unknown   -> indeterminate: a dispatch was attempted but delivery cannot
 *                be determined from the information available.
 *
 * Exported as a single source of truth so the schema, the dispatcher, the
 * outbox worker and the inbox UI cannot drift apart about which states exist.
 */
export const DELIVERY_STATES = ['queued', 'sent', 'delivered', 'failed', 'unknown'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATES)[number];

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
  /**
   * True ONLY when there is a real delivery receipt from the channel
   * (read/routed confirmation), not merely a successful dispatch. When
   * omitted or false, a successful dispatch is `sent` — never `delivered`.
   * This is what enforces "never fake green ticks": no code path can
   * produce a double-tick without an actual delivery confirmation.
   */
  deliveryConfirmed?: boolean;
}): DispatchOutcome {
  const { blocker, directSendSucceeded, queuedForRetry, error, deliveryConfirmed } = args;

  // Nothing could be attempted: fail immediately and visibly.
  if (blocker) {
    return { status: 'failed', error: blocker, accepted: false };
  }

  if (directSendSucceeded) {
    // A successful dispatch is only 'delivered' when we have a real
    // delivery receipt; otherwise it is honestly 'sent' (dispatched, not
    // confirmed delivered).
    return deliveryConfirmed
      ? { status: 'delivered', accepted: true }
      : { status: 'sent', accepted: true };
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
