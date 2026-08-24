import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { runCancellationFollowupCron } from '@/lib/revenue/cancellation-followup';
import { drizzleCancellationFollowupStore } from '@/lib/revenue/cancellation-followup-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Every 6 hours, each run resolving up to 50 reservations with 2-3 queries
// apiece. Same ceiling as the outbox cron; Vercel's default 10s would cut a
// batch in half.
export const maxDuration = 60;

/**
 * Gate #3 — cancellation follow-up cron.
 *
 * All the decision logic (who is due, what the message says, when a row is
 * marked sent) lives in lib/revenue/cancellation-followup.ts, and the
 * Postgres access in its store adapter. This handler is only the cron
 * boundary: authenticate, respect the global kill-switch, run, report.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  // The global kill-switch exists so automated AI messaging can be stopped
  // instantly, without a redeploy. An unattended marketing message is exactly
  // what it should stop, so this run bows out rather than queueing follow-ups
  // nobody can recall.
  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', sent: 0 });
  }

  const summary = await runCancellationFollowupCron(drizzleCancellationFollowupStore, { now: new Date() });

  console.log(
    `[Cancellation Follow-Up] scanned=${summary.scanned} sent=${summary.sent} ` +
      `noRecipient=${summary.skipped.noRecipient} failed=${summary.skipped.failed}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
