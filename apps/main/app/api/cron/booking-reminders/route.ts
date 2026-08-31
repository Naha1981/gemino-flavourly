import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { canSendAutomatedMessages } from '@/lib/billing/gate-evaluate';
import { runReminderCron } from '@/lib/revenue/reminder-ladder';
import { drizzleReminderStore } from '@/lib/revenue/reminder-ladder-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Every 15 minutes, each run resolving up to 100 bookings with 2-3 queries
// apiece. Same ceiling as the outbox and no-show crons.
export const maxDuration = 60;

/**
 * O2 — booking reminder ladder cron (48h / 24h / 6h).
 *
 * All decision logic (which rung is due, the disjoint windows, the copy)
 * lives in lib/revenue/reminder-ladder.ts and the Postgres access in its
 * store adapter. This handler is only the cron boundary: authenticate,
 * respect the global kill-switch, run, report.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  // Global kill-switch: an unattended reminder is exactly the class of
  // message it exists to stop.
  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', sent: 0 });
  }

  const summary = await runReminderCron(drizzleReminderStore, {
    now: new Date(),
    isSendable: canSendAutomatedMessages,
  });

  console.log(
    `[Reminders] scanned=${summary.scanned} sent=${summary.sent} ` +
      `notDue=${summary.skipped.notDue} alreadySent=${summary.skipped.alreadySent} ` +
      `noRecipient=${summary.skipped.noRecipient} billingBlocked=${summary.skipped.billingBlocked} ` +
      `failed=${summary.skipped.failed}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
