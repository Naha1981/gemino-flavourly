import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { expireStaleRewardEvents } from '@/lib/customer/reward-claim-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * O1 — reward_events expiry sweep.
 *
 * Pending geo-claim events are single-use and short-lived (30-minute TTL);
 * this cron is the sweeper that flips lapsed pending rows to `expired` so
 * the loyalty dashboard never lists dead links as live. Idempotent by
 * construction (a row can only be flipped once — `WHERE status='pending'`),
 * so overlapping runs are harmless.
 *
 * Registered in the canonical cron fleet (scripts/cron-fleet.json — never
 * vercel.json) — every 15 minutes.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  try {
    const expiredCount = await expireStaleRewardEvents(new Date());
    return NextResponse.json({ ok: true, expiredCount });
  } catch (err) {
    console.error('[cron:reward-expiry] sweep failed:', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
