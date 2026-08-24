import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { reviewRequestStats } from '@/lib/reputation/review-request-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #13 — review request metrics. "Response rate if trackable": Google
 * does not attribute a review to the ask, so the honest trackable signal is
 * new review volume AFTER requests began flowing; that lives on the
 * reputation stats endpoint. Here: send volumes only, no invented rates.
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = await reviewRequestStats(tenant.id);
  return NextResponse.json({
    sent_last_30_days: stats.sentLast30Days,
    sent_total: stats.sentTotal,
  });
}
