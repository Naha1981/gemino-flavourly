import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { runReactivationCampaignCron } from '@/lib/customer/reactivation-cron';
import { drizzleReactivationStore } from '@/lib/customer/reactivation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Schedule this endpoint DAILY AT 10:00 in cron-job.org after deployment
// (added manually after merge, like the other crons). 10am local send time
// keeps win-back messages out of dinner service and out of customers'
// evenings; the run itself is idempotent thanks to the 90-day cooldown.
export const maxDuration = 60;

/**
 * Gate #9 — reactivation campaigns cron.
 *
 * Authentication is the first operation in the handler. The runner and
 * store keep the eligibility rules (dormant/at-risk, POPIA opt-out, tenant
 * flags, 90-day cooldown) independently testable while this route remains
 * a thin, CRON_SECRET-protected adapter.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  // The global kill-switch stops ALL automated messaging instantly without
  // a redeploy. An unattended win-back marketing blast is exactly what it
  // exists for — bow out before creating a single campaign row.
  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', sent: 0 });
  }

  const summary = await runReactivationCampaignCron(drizzleReactivationStore, { now: new Date() });

  console.log(
    `[Reactivation] tenants=${summary.tenantsChecked} candidates=${summary.candidatesScanned} ` +
      `created=${summary.campaignsCreated} sent=${summary.sent} ` +
      `cooldownSkipped=${summary.skipped.recentCampaign} failed=${summary.skipped.failed}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
