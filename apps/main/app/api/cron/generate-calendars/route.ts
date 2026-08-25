import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { eq } from 'drizzle-orm';
import { runCalendarPlanner } from '@/lib/marketing/calendar-planner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Gate #20 — calendar generation cron.
 *
 * Builds a marketing calendar for each tenant and saves draft events.
 * The handler is only the cron boundary: authenticate, respect the global
 * kill-switch, run, report.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', eventsCreated: 0 });
  }

  const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.aiEnabled, true));
  let totalCreated = 0;

  for (const tenant of allTenants) {
    const result = await runCalendarPlanner(tenant.id, tenant.name);
    totalCreated += result.eventsCreated;
  }

  return NextResponse.json({ ok: true, tenantsChecked: allTenants.length, eventsCreated: totalCreated });
}
