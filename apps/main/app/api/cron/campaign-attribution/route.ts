import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { reconcileCampaignAttribution } from '@/lib/marketing/attribution-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const tenantRows = await db.select({ id: tenants.id }).from(tenants);
  let campaigns = 0;
  let sent = 0;
  let responded = 0;
  let booked = 0;
  let estimatedRevenueCents = 0;
  let realizedRevenueCents = 0;

  for (const tenant of tenantRows) {
    const summaries = await reconcileCampaignAttribution(tenant.id);
    campaigns += summaries.length;
    for (const summary of summaries) {
      sent += summary.sent;
      responded += summary.responded;
      booked += summary.booked;
      estimatedRevenueCents += summary.estimatedRevenueCents;
      realizedRevenueCents += summary.realizedRevenueCents;
    }
  }

  return NextResponse.json({
    ok: true,
    tenants: tenantRows.length,
    campaigns,
    sent,
    responded,
    booked,
    estimatedRevenueCents,
    realizedRevenueCents,
    checkedAt: new Date().toISOString(),
  });
}
