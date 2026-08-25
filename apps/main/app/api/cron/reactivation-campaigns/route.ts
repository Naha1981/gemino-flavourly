import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { canSendAutomatedMessages } from '@/lib/billing/gate-evaluate';
import { runReactivationCampaignCron } from '@/lib/customer/reactivation-cron';
import { drizzleReactivationCronStore } from '@/lib/customer/reactivation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Schedule daily at 10:00 in cron-job.org after deployment (added manually,
// like the other crons) — late enough that overnight segmentation runs have
// refreshed everyone's segment, before the lunch booking rush.
export const maxDuration = 60;

/**
 * Gate #9 — reactivation campaign cron.
 *
 * All the decision logic (eligibility, cooldown, POPIA skips, copy) lives in
 * lib/customer/reactivation.ts + reactivation-cron.ts, and the Postgres
 * access in the store adapter. This handler is only the cron boundary:
 * authenticate, respect the global kill-switch, run, report.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  // The global kill-switch exists so automated AI messaging can be stopped
  // instantly, without a redeploy. An unattended win-back broadcast is
  // exactly what it should stop.
  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', sent: 0 });
  }

  const summary = await runReactivationCampaignCron(drizzleReactivationCronStore, { now: new Date(), isSendable: canSendAutomatedMessages });

  console.log(
    `[Reactivation] tenants=${summary.tenantsChecked} candidates=${summary.candidatesScanned} ` +
      `created=${summary.created} resumed=${summary.resumed} sent=${summary.sent} ` +
      `optedOut=${summary.skipped.optedOut} cooldown=${summary.skipped.cooldown} ` +
      `notEligible=${summary.skipped.notEligible} failed=${summary.skipped.failed}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
