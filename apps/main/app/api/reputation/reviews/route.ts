import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getReviews } from '@/lib/reputation/review-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 50), 100);
  const offset = Math.max(Number(req.nextUrl.searchParams.get('offset') || 0), 0);
  return NextResponse.json({ reviews: await getReviews(tenant.id, limit, offset) });
}
