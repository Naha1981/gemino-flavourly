import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { runNoShowCron } from '@/lib/revenue/no-show';
import { drizzleNoShowStore } from '@/lib/revenue/no-show-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Every 30 minutes, each run stamping up to 50 no-shows and offering up to
// 50 rebooks with a handful of queries apiece. Same ceiling as the other
// revenue crons; Vercel's default 10s would cut a batch in half.
export const maxDuration = 60;

/**
 * Gate #4 — no-show monitoring cron.
 *
 * Schedule: every 30 minutes (cron-job.org, added manually after merge —
 * the same place the daily brief, outbox and follow-up jobs are
 * scheduled). Auth is the shared CRON_SECRET bearer guard every other
 * cron uses.
 *
 * All the decision logic (when a booking is a no-show, what the offer
 * says, when a row is marked sent) lives in lib/revenue/no-show.ts, and
 * the Postgres access in its store adapter. This handler is only the cron
 * boundary: authenticate, respect the global kill-switch, run, report.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  // The global kill-switch exists so automated AI messaging can be stopped
  // instantly, without a redeploy. An unattended rebook offer is exactly
  // what it should stop, so this run bows out rather than queueing offers
  // nobody can recall.
  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', detected: 0, sent: 0 });
  }

  const summary = await runNoShowCron(drizzleNoShowStore, { now: new Date() });

  console.log(
    `[No-Show Monitoring] detected=${summary.detected} scanned=${summary.scanned} sent=${summary.sent} ` +
      `noRecipient=${summary.skipped.noRecipient} manualTakeover=${summary.skipped.manualTakeover} ` +
      `failed=${summary.skipped.failed}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
