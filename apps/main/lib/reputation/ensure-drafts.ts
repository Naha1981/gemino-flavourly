import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { googleReviews, tenants } from '@/lib/db/schema';
import { draftReviewResponse, classifyThemesWithGroqGemini, type ThemeClassifier } from './response-generator.ts';
import { shouldDraft, fallbackDraftFor } from './draft-policy.ts';

/**
 * GATE UI-3R / F6 — pre-generated review drafts (DB orchestration).
 *
 * Backfills drafts for draft-less, unsent reviews on Reputation page load:
 *   - never overwrites an existing draft or a sent response (the UPDATE is
 *     guarded to fire only while the draft column is still empty);
 *   - respects the master kill-switch and the tenant's aiEnabled flag —
 *     when AI is off, the deterministic template from draft-policy.ts is
 *     used and clearly labelled;
 *   - bounded per run (default 25) so a page load can never fan out into
 *     hundreds of provider calls (AI budget guard).
 *
 * Steady state is zero writes: after the first backfill, every review has a
 * draft and the page reload performs no UPDATEs at all.
 */

export { shouldDraft, fallbackDraftFor } from './draft-policy.ts';

export interface EnsureDraftsResult {
  draftsCreated: number;
  inspected: number;
}

async function aiPermitted(tenantId: string): Promise<boolean> {
  // Master kill-switch first — one row, platform-wide.
  const settings = await db.query.systemSettings.findFirst().catch(() => null);
  if (settings && settings.masterAiSwitch === false) return false;
  // Then the tenant's own switch.
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }).catch(() => null);
  if (tenant && tenant.aiEnabled === false) return false;
  return true;
}

/**
 * Generate and persist drafts for every draft-less, unsent review of this
 * tenant. Idempotent by construction (see module doc).
 */
export async function ensureReviewDrafts(
  tenantId: string,
  options: { limit?: number; classifier?: ThemeClassifier } = {}
): Promise<EnsureDraftsResult> {
  const limit = options.limit ?? 25;

  const rows = await db
    .select({
      reviewId: googleReviews.reviewId,
      authorName: googleReviews.authorName,
      rating: googleReviews.rating,
      text: googleReviews.text,
      sentiment: googleReviews.sentiment,
      responseText: googleReviews.responseText,
      responseSentAt: googleReviews.responseSentAt,
    })
    .from(googleReviews)
    .where(
      and(
        eq(googleReviews.tenantId, tenantId),
        isNull(googleReviews.responseSentAt),
        or(isNull(googleReviews.responseText), eq(googleReviews.responseText, ''))
      )
    )
    .limit(limit)
    .catch(() => []);

  const eligible = rows.filter((r) =>
    shouldDraft({ responseText: r.responseText ?? null, responseSentAt: r.responseSentAt ?? null })
  );
  if (eligible.length === 0) return { draftsCreated: 0, inspected: rows.length };

  const aiOk = await aiPermitted(tenantId);

  let draftsCreated = 0;
  for (const review of eligible) {
    try {
      const draft = aiOk
        ? await draftReviewResponse(
            {
              authorName: review.authorName,
              rating: review.rating,
              text: review.text,
              sentiment: (review.sentiment as 'positive' | 'neutral' | 'negative') ?? 'neutral',
            },
            {},
            { classifier: options.classifier ?? classifyThemesWithGroqGemini }
          )
        : fallbackDraftFor({
            authorName: review.authorName,
            rating: review.rating,
            text: review.text,
            sentiment: review.sentiment,
          });

      const changed = await db
        .update(googleReviews)
        .set({ responseText: draft })
        .where(
          and(
            eq(googleReviews.tenantId, tenantId),
            eq(googleReviews.reviewId, review.reviewId),
            // Guard against racing an owner edit: only write while still empty.
            or(isNull(googleReviews.responseText), eq(googleReviews.responseText, ''))
          )
        )
        .returning({ id: googleReviews.id })
        .catch(() => []);
      if (changed.length > 0) draftsCreated += 1;
    } catch (err) {
      console.error(`[ensureReviewDrafts] failed for review ${review.reviewId}`, err);
    }
  }

  return { draftsCreated, inspected: rows.length };
}
