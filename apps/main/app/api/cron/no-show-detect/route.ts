import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { runNoShowCron } from '@/lib/revenue/no-show';
import { drizzleNoShowStore } from '@/lib/revenue/no-show-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Every 30 minutes, each run resolving up to 100 reservations (50 detected
// + 50 messaged) with 2-3 queries apiece. Same ceiling as the outbox cron;
// Vercel's default 10s would cut a batch in half.
export const maxDuration = 60;

/**
 * Gate #4 — no-show detection + rebooking follow-up cron.
 *
 * All the decision logic (the detection cutoff, who is due, what the
 * message says, when a row is marked) lives in lib/revenue/no-show.ts,
 * and the Postgres access in its store adapter. This handler is only the
 * cron boundary: authenticate, respect the global kill-switch, run,
 * report.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  // The global kill-switch exists so automated AI messaging can be stopped
  // instantly, without a redeploy. An unattended marketing message is
  // exactly what it should stop, so this run bows out rather than flagging
  // no-shows and queueing follow-ups nobody can recall.
  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', sent: 0 });
  }

  const summary = await runNoShowCron(drizzleNoShowStore, { now: new Date() });

  console.log(
    `[No-Show] detected=${summary.detection.detected}/${summary.detection.scanned} ` +
      `sent=${summary.followup.sent}/${summary.followup.scanned} ` +
      `noRecipient=${summary.followup.skipped.noRecipient} failed=${summary.followup.skipped.failed}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
