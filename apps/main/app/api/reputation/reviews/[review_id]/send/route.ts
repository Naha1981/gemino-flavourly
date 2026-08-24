import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getReviewByGoogleId, markResponseSent, updateResponseDraft } from '@/lib/reputation/review-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #12 — "Send Response": the owner has posted the response to Google
 * (the platform marks it sent; posting to Google itself is the owner's
 * action in their Business Profile). Stamps response_sent_at.
 *
 * Accepts an optional final { response_text } so the UI can save last-second
 * edits and mark sent in one atomic-feeling call.
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

  let finalText: string | null = null;
  try {
    const body = (await req.json()) as { response_text?: unknown };
    if (typeof body.response_text === 'string' && body.response_text.trim()) {
      finalText = body.response_text.trim().slice(0, 2000);
    }
  } catch {
    // Empty body is fine — send exactly what was drafted.
  }

  if (!finalText && !review.responseText) {
    return NextResponse.json(
      { error: 'No response drafted yet — draft or edit one before sending' },
      { status: 400 }
    );
  }

  if (finalText) {
    await updateResponseDraft(tenant.id, params.review_id, finalText);
  }

  const sentAt = await markResponseSent(tenant.id, params.review_id, new Date());

  return NextResponse.json({ ok: true, review_id: params.review_id, response_sent_at: sentAt });
}
