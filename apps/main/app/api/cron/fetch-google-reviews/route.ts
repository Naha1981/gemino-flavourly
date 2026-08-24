import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { runReviewSyncCron } from '@/lib/reputation/review-sync';
import { drizzleReviewSyncStore } from '@/lib/reputation/review-store';
import { classifyThemesWithGroqGemini } from '@/lib/reputation/response-generator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One Places API call per configured tenant plus a handful of upserts per
// review; the default 10s ceiling could truncate a multi-tenant batch.
export const maxDuration = 60;

/**
 * Gate #11 + #12 — daily Google review fetch (06:00 SAST via cron-job.org).
 *
 * The decision logic lives in lib/reputation/review-sync.ts and the Postgres
 * access in its Drizzle adapter; this handler is only the cron boundary:
 * authenticate, respect the global kill-switch, run, report.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  // The kill-switch stops outbound automated MESSAGING, and a review pull
  // would still be safe with it off — but honouring it here too keeps "stop
  // all AI automation" a single, predictable switch for the operator.
  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', reviewsUpserted: 0 });
  }

  const summary = await runReviewSyncCron(drizzleReviewSyncStore, {
    now: new Date(),
    classifier: classifyThemesWithGroqGemini,
  });

  console.log(
    `[ReviewSync] tenants=${summary.tenantsFetched}/${summary.tenantsChecked} ` +
      `upserted=${summary.reviewsUpserted} new=${summary.newReviews} drafts=${summary.draftsCreated} ` +
      `noApiKey=${summary.skipped.noApiKey} failed=${summary.skipped.tenantFailed}/${summary.skipped.reviewFailed}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
