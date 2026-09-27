import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export type IntentResult = {
  intent: 'booking' | 'purchase' | 'menu' | 'complaint' | 'loyalty' | 'waitlist' | 'human' | 'unknown';
  score: number;
  nextAction: string;
  evidence: string;
};

const RULES: Array<{ intent: IntentResult['intent']; score: number; pattern: RegExp; action: string; evidence: string }> = [
  { intent: 'booking', score: 96, pattern: /\b(book|booking|reserve|reservation|table for|available tonight|dinner for|lunch for)\b/i, action: 'Capture date, time and party size; finish the booking draft.', evidence: 'Explicit booking language' },
  { intent: 'purchase', score: 91, pattern: /\b(order|buy|take away|takeout|delivery|what should i eat|recommend|hungry|want something)\b/i, action: 'Recommend 2–3 available menu items and one measured add-on.', evidence: 'Explicit purchase or recommendation language' },
  { intent: 'complaint', score: 99, pattern: /\b(refund|money back|lawyer|legal|allergic|food poisoning|unsafe|manager|complaint|angry|terrible)\b/i, action: 'Move to human approval/takeover and protect the customer record.', evidence: 'High-risk service or safety language' },
  { intent: 'loyalty', score: 94, pattern: /\b(points|loyalty|reward|redeem|birthday)\b/i, action: 'Answer from the canonical loyalty rules and surface the next available reward.', evidence: 'Loyalty keywords' },
  { intent: 'waitlist', score: 93, pattern: /\b(waitlist|queue|waiting for a table|join the wait)\b/i, action: 'Add to waitlist and notify when a matching table opens.', evidence: 'Waitlist language' },
  { intent: 'human', score: 97, pattern: /\b(human|person|staff|manager|owner|agent|someone real)\b/i, action: 'Trigger manual takeover and notify floor staff.', evidence: 'Human handoff request' },
  { intent: 'menu', score: 86, pattern: /\b(menu|dish|food|drink|vegetarian|vegan|gluten|price|cost|special)\b/i, action: 'Answer from the restaurant menu and availability state.', evidence: 'Menu question' },
];

export function scoreIntent(text: string): IntentResult {
  const match = RULES
    .filter((rule) => rule.pattern.test(text))
    .sort((a, b) => b.score - a.score)[0];
  if (!match) {
    return { intent: 'unknown', score: 25, nextAction: 'Use the grounded concierge fallback and look for a stronger signal.', evidence: 'No high-confidence rule matched' };
  }
  return { intent: match.intent, score: match.score, nextAction: match.action, evidence: match.evidence };
}

export async function recordIntentScore(input: {
  tenantId: string;
  conversationId: string;
  messageId: string;
  text: string;
}): Promise<IntentResult> {
  const result = scoreIntent(input.text);
  await db.execute(sql`
    INSERT INTO intent_scores (tenant_id, conversation_id, message_id, intent, score, next_action, evidence)
    VALUES (${input.tenantId}, ${input.conversationId}, ${input.messageId}, ${result.intent}, ${result.score}, ${result.nextAction}, ${result.evidence})
  `).catch((error) => console.error('[Intent] failed to persist score', error));
  return result;
}

export async function latestIntentForConversation(conversationId: string): Promise<IntentResult | null> {
  const result = await db.execute(sql`
    SELECT intent, score, next_action, evidence
    FROM intent_scores
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = ((result as any).rows ?? result as any[])[0];
  if (!row) return null;
  return { intent: row.intent, score: Number(row.score), nextAction: row.next_action, evidence: row.evidence ?? '' };
}
