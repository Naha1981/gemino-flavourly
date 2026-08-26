/**
 * Approval workflow — risk classification + dispatch decision (Engine 6).
 *
 * The PRD requires that outbound messages are governed by an approval
 * workflow:
 *   GREEN  -> auto-send (routine booking/menu/hours/loyalty replies)
 *   YELLOW -> the owner approves before it is sent
 *   RED    -> the owner controls it (always held for explicit approval)
 *
 * This module is pure (no Drizzle/Next imports) so the rules are unit-testable
 * in isolation. The Postgres adapter lives in ./approval-request-store.ts; the
 * webhook / manual-send routes call `classifyMessageRisk()` and then either
 * enqueue directly (GREEN) or create an approval request (YELLOW/RED).
 */

export type ApprovalRiskLevel = 'green' | 'yellow' | 'red';

export type ApprovalAction =
  | { outcome: 'auto_send' }
  | { outcome: 'require_approval'; riskLevel: 'yellow' | 'red'; reason: string };

/**
 * Signals that make a message RED — things that could financially or legally
 * commit the restaurant, or that a human should always own. These are kept
 * conservative and message-scoped: a message that mentions a refund or an
 * unconditional discount is RED, not GREEN.
 */
const RED_SIGNALS = [
  'refund',
  'full refund',
  'money back',
  'cancel my subscription',
  'refunded',
  'reimburse',
  'injury',
  'food poisoning',
  'sue',
  'lawyer',
  'legal',
  'complaint department',
  'manager immediately',
];

/** Signals that make a message YELLOW — promotional / offer / apology content. */
const YELLOW_SIGNALS = [
  'discount',
  'promo',
  'offer',
  'voucher',
  'free drink',
  'complimentary',
  'special price',
  'deal',
  '2-for-1',
  'happy hour',
  'sorry',
  'apolog',
  'unique gift',
];

function textContains(text: string, needles: string[]): string | null {
  const lower = text.toLowerCase();
  return needles.find((n) => lower.includes(n)) ?? null;
}

/** Classify an outbound message by its risk level. */
export function classifyMessageRisk(text: string): ApprovalRiskLevel {
  const t = (text ?? '').trim();
  if (!t) return 'yellow'; // an empty message should never auto-send

  const red = textContains(t, RED_SIGNALS);
  if (red) return 'red';

  const yellow = textContains(t, YELLOW_SIGNALS);
  if (yellow) return 'yellow';

  return 'green';
}

/**
 * The decision the send path should take for a classified message. GREEN
 * auto-sends; YELLOW and RED are both held for owner approval (RED is the
 * same "owner controls" path — the distinction is the reason captured).
 */
export function decideApprovalAction(risk: ApprovalRiskLevel): ApprovalAction {
  if (risk === 'green') return { outcome: 'auto_send' };
  const reason =
    risk === 'red'
      ? 'Financial / legal / service-sensitive content — owner must review before dispatch.'
      : 'Promotional or offer content — owner approval recommended before dispatch.';
  return { outcome: 'require_approval', riskLevel: risk, reason };
}

/**
 * Convenience used by tests and callers that want the risk level for a list
 * of candidate texts. Returns the worst (most restrictive) level, so an
 * aggregate of a thread can be labelled conservatively.
 */
export function worstRiskLevel(levels: ApprovalRiskLevel[]): ApprovalRiskLevel {
  if (levels.includes('red')) return 'red';
  if (levels.includes('yellow')) return 'yellow';
  return 'green';
}
