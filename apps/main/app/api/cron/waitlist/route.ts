import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { runWaitlistAutoOffer } from '@/lib/revenue/waitlist-auto-offer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  try {
    const result = await runWaitlistAutoOffer();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[Waitlist] auto-offer sweep failed', error);
    return NextResponse.json({ ok: false, error: 'Waitlist sweep failed' }, { status: 500 });
  }
}
