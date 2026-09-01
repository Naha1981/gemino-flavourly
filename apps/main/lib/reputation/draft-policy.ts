import { generateResponse } from './response-generator.ts';

/**
 * GATE UI-3R / F6 — pure draft-policy decisions (no database imports, so
 * node --test can load this module directly).
 *
 * Symptom S11: every review card opened with "No draft yet — press
 * Regenerate". The ingest cron already drafts NEW reviews (review-sync.ts,
 * Gate #12), but reviews that predate that path sat draft-less forever.
 * These pure decisions back the on-load backfill in ensure-drafts.ts.
 */

/** Pure decision: does this review need a draft generated? */
export function shouldDraft(review: { responseText: string | null; responseSentAt: Date | null }): boolean {
  if (review.responseSentAt) return false; // sent — untouchable
  return !review.responseText || review.responseText.trim() === '';
}

/**
 * The AI-off path: the deterministic rule-based template, clearly labelled
 * as automatically prepared so the owner knows it hasn't been personalised
 * by the AI (kill-switch on, no provider keys, or budget guard tripped).
 */
export function fallbackDraftFor(review: {
  authorName: string | null;
  rating: number;
  sentiment: string | null;
  text: string | null;
}): string {
  const base = generateResponse({
    authorName: review.authorName ?? '',
    rating: review.rating,
    text: review.text,
    sentiment: (review.sentiment as 'positive' | 'neutral' | 'negative') ?? 'neutral',
  });
  return `${base} (Draft prepared automatically — review before sending.)`;
}
