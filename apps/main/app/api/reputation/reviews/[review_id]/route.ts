import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getReviewByGoogleId, updateResponseDraft } from '@/lib/reputation/review-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #12 — owner edits the AI-drafted response before posting it to
 * Google. PATCH only ever touches response_text on the tenant's own review.
 */
export async function PATCH(req: NextRequest, { params }: { params: { review_id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { response_text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const responseText = typeof body.response_text === 'string' ? body.response_text.trim() : '';
  if (!responseText) {
    return NextResponse.json({ error: 'response_text is required and cannot be empty' }, { status: 400 });
  }
  if (responseText.length > 2000) {
    return NextResponse.json({ error: 'response_text is too long (max 2000 chars)' }, { status: 400 });
  }

  const review = await getReviewByGoogleId(tenant.id, params.review_id);
  if (!review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  }

  await updateResponseDraft(tenant.id, params.review_id, responseText);

  return NextResponse.json({ ok: true, review_id: params.review_id, response_text: responseText });
}
