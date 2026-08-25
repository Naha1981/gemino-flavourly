import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { canSendAutomatedMessages } from '@/lib/billing/gate-evaluate';
import { runReviewRequestCron, type ReviewRequestStore } from '@/lib/reputation/review-request-cron';
import {
  findReviewRequestTenants,
  getEligibleReservations,
  getPlaceId,
  isManualTakeover,
  markRequestSent,
  queueReviewRequestMessage,
  resolveReviewRequestSender,
} from '@/lib/reputation/review-request-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One query per tenant plus a couple per eligible reservation; the default
// 10s ceiling could truncate a busy dinner service's sweep.
export const maxDuration = 60;

/**
 * Gate #13 — hourly post-visit review requests (cron-job.org, hourly).
 *
 * The store adapter below satisfies the framework-free runner's interface;
 * this handler is only the cron boundary: authenticate, honour the global
 * kill-switch, run, report.
 */
const cronStore: ReviewRequestStore = {
  findTenants: findReviewRequestTenants,
  getPlaceId,
  getEligibleReservations,
  isManualTakeover,
  queueMessage: queueReviewRequestMessage,
  resolveSender: resolveReviewRequestSender,
  markRequestSent,
};

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  // The kill-switch is precisely for outbound automated messaging — this
  // cron queues customer-facing WhatsApp messages, so it bows out entirely.
  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', sent: 0 });
  }

  const summary = await runReviewRequestCron(cronStore, { now: new Date(), isSendable: canSendAutomatedMessages });

  console.log(
    `[ReviewRequest] sent=${summary.sent}/${summary.reservationsScanned} ` +
      `disabled=${summary.skipped.tenantDisabled} noConfig=${summary.skipped.noPlaceConfig} ` +
      `noSender=${summary.skipped.noSender} optedOut=${summary.skipped.optedOut} ` +
      `takeover=${summary.skipped.manualTakeover} failed=${summary.skipped.failed}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
