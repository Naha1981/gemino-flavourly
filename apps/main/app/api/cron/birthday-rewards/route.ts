import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { runBirthdayRewards } from '@/lib/customer/birthday-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Birthday rewards cron — runs daily (scheduled via cron-job.org, e.g. 07:00).
 *
 * For every tenant, generates a personalised reward offer + WhatsApp message
 * for any customer whose birthday falls in the next 7 days, and queues it
 * through the outbox for guaranteed, retried delivery. POPIA: blocklisted
 * (opted-out) contacts are never targeted.
 *
 * Guarded like every cron route by assertCronAuthorized.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const result = await runBirthdayRewards();

  return NextResponse.json({ ok: true, ...result });
}
