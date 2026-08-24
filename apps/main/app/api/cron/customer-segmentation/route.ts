import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { assertCronAuthorized } from '@/lib/cron/auth';
import {
  fetchProfilesForSegmentation,
  updateSegment,
} from '@/lib/customer/segmentation-store';
import {
  runCustomerSegmentationCron,
  type CustomerSegmentationStore,
} from '@/lib/customer/segmentation-cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Schedule this endpoint every 6 hours in cron-job.org after deployment.
// Profiles are scanned in full so a segment can move in either direction as
// spend, visits, and recency change.
export const maxDuration = 60;

/**
 * Gate #8 — customer segmentation cron.
 *
 * Authentication is the first operation in the handler. The runner and
 * store keep the tenant loop and mutation rules independently testable while
 * this route remains a thin, CRON_SECRET-protected adapter.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const store: CustomerSegmentationStore = {
    async findTenantIds(): Promise<string[]> {
      const rows = await db.select({ id: tenants.id }).from(tenants);
      return rows.map((row) => row.id);
    },
    fetchProfilesForSegmentation,
    updateSegment,
  };

  const summary = await runCustomerSegmentationCron(store, { now: new Date() });

  console.log(
    `[Customer Segmentation] tenants=${summary.tenantsChecked} ` +
      `profiles=${summary.profilesScanned} updated=${summary.segmentsUpdated} failed=${summary.failed}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
