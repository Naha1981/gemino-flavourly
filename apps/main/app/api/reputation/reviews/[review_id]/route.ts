import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { googleReviews } from '@/lib/db/schema';
import { getOrCreateTenant } from '@/lib/tenant';
import { generateResponse } from '@/lib/reputation/response-generator';
import { getReviewByGoogleId } from '@/lib/reputation/review-store';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { review_id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const [review] = await db.update(googleReviews).set({ responseText: String(body.responseText || '') })
    .where(and(eq(googleReviews.tenantId, tenant.id), eq(googleReviews.reviewId, params.review_id))).returning();
  if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  return NextResponse.json({ review });
}

export async function POST(req: Request, { params }: { params: { review_id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const current = await getReviewByGoogleId(tenant.id, params.review_id);
  if (!current) return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  const [review] = await db.update(googleReviews).set({ responseText: generateResponse(current), responseSentAt: new Date() })
    .where(and(eq(googleReviews.tenantId, tenant.id), eq(googleReviews.reviewId, params.review_id))).returning();
  return NextResponse.json({ review });
}