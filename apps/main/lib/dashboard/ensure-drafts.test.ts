import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * GATE UI-3R / F6 — pre-generated review drafts.
 *
 * Symptom S11: every review card said "No draft yet — press Regenerate".
 * The ingest path already drafts new reviews (review-sync.ts Gate #12), but
 * reviews that predate that — or arrive via other paths — render draft-less
 * forever. F6 adds an on-load backfill. Failing-first: module does not exist.
 */

describe('F6 — shouldDraft decision logic', () => {
  test('a draft-less, unsent review needs a draft', async () => {
    const { shouldDraft } = await import('../reputation/draft-policy.ts');
    assert.equal(shouldDraft({ responseText: null, responseSentAt: null }), true);
    assert.equal(shouldDraft({ responseText: '', responseSentAt: null }), true);
  });

  test('a review that already has a draft is left alone (never overwritten)', async () => {
    const { shouldDraft } = await import('../reputation/draft-policy.ts');
    assert.equal(shouldDraft({ responseText: 'Thanks for the feedback!', responseSentAt: null }), false);
  });

  test('a sent response is never re-drafted', async () => {
    const { shouldDraft } = await import('../reputation/draft-policy.ts');
    assert.equal(shouldDraft({ responseText: null, responseSentAt: new Date() }), false);
    assert.equal(shouldDraft({ responseText: 'sent text', responseSentAt: new Date() }), false);
  });
});

describe('F6 — deterministic fallback template', () => {
  test('the AI-off path still produces a usable, clearly-labelled draft', async () => {
    const { fallbackDraftFor } = await import('../reputation/draft-policy.ts');
    const draft = fallbackDraftFor({ authorName: 'Pieter S.', rating: 3, sentiment: 'neutral', text: 'Food was good, service a little slow.' });
    assert.ok(draft.length > 20, 'draft must be substantive');
    assert.match(draft, /Pieter|there/, 'draft must address the reviewer');
    assert.match(draft, /Draft prepared automatically/, 'deterministic drafts must be labelled as such');
  });
});
