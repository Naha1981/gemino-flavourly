import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getReviewByGoogleId, updateResponseDraft } from '@/lib/reputation/review-store';
import { draftReviewResponse, classifyThemesWithGroqGemini } from '@/lib/reputation/response-generator';

export const dynamic = 'force-dynamic';

/**
 * Gate #12 — "Regenerate": produce a fresh AI draft for a review and store
 * it. Unlike the cron's setResponseDraftIfAbsent, regeneration explicitly
 * REPLACES the current draft — that is what the owner asked for. A review
 * whose response was already SENT cannot be silently re-drafted (409).
 */
export async function POST(req: NextRequest, { params }: { params: { review_id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const review = await getReviewByGoogleId(tenant.id, params.review_id);
  if (!review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  }

  if (review.responseSentAt) {
    return NextResponse.json(
      { error: 'Response already sent on ' + review.responseSentAt.toISOString() + ' — refusing to re-draft a sent response' },
      { status: 409 }
    );
  }

  const draft = await draftReviewResponse(
    {
      authorName: review.authorName,
      rating: review.rating,
      text: review.text,
      sentiment: review.sentiment as 'positive' | 'neutral' | 'negative',
    },
    {},
    { classifier: classifyThemesWithGroqGemini }
  );

  const changed = await updateResponseDraft(tenant.id, params.review_id, draft);
  if (!changed) {
    // Raced with a delete; do not resurrect.
    return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, review_id: params.review_id, response_text: draft });
}
