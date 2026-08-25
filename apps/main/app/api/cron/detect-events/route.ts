import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { eq } from 'drizzle-orm';
import { detectEventOpportunities } from '@/lib/marketing/event-detector';
import { saveOpportunities } from '@/lib/market/opportunity-store';
import type { Opportunity } from '@/lib/market/opportunity-analyzer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Gate #19 — event detection cron.
 *
 * Scans the next 30 days for fixed restaurant-relevant dates and saves them
 * as marketing opportunities per tenant. The handler is only the cron
 * boundary: authenticate, respect the global kill-switch, run, report.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', opportunitiesDetected: 0 });
  }

  const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.aiEnabled, true));
  let totalOpportunities = 0;
  let totalSaved = 0;

  for (const tenant of allTenants) {
    const opportunities = detectEventOpportunities(tenant.id);
    totalOpportunities += opportunities.length;

    if (opportunities.length > 0) {
      const { upserted } = await saveOpportunities(tenant.id, opportunities as unknown as Opportunity[]);
      totalSaved += upserted;
    }
  }

  return NextResponse.json({ ok: true, tenantsChecked: allTenants.length, opportunitiesDetected: totalOpportunities, opportunitiesSaved: totalSaved });
}
