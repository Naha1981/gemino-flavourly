import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tenants, messages, reservations, jobs, waAccounts } from '@/lib/db/schema';
import { eq, sql, and, gte } from 'drizzle-orm';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { detectSlowDaysForTenant, slowDayAlertLines } from '@/lib/revenue/slow-days';
import { drizzleSlowDayStore } from '@/lib/revenue/slow-days-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  // Morning brief for restaurant owners (runs at 07:00 — see vercel cron
  // schedule / cron-job.org config).
  //
  // Previously counted ALL-TIME messages and reservations with no date
  // filter at all, despite the comment saying "yesterday's counts" — an
  // owner with 3 total conversations ever would see "142 messages today"
  // on day one. Also never actually sent anything anywhere; it only
  // console.log'd server-side, which no one — least of all a restaurant
  // owner — ever sees. Now scoped to the last 24h and delivered as an
  // actual WhatsApp message via the same outbox pattern as everything
  // else, sent to the tenant's own connected number.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const allTenants = await db.query.tenants.findMany({
    where: eq(tenants.aiEnabled, true),
  });

  let briefed = 0;
  let alerted = 0;

  for (const tenant of allTenants) {
    const [msgCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(and(eq(messages.tenantId, tenant.id), gte(messages.createdAt, since)));

    const [bookingCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(reservations)
      .where(and(eq(reservations.tenantId, tenant.id), gte(reservations.date, since)));

    // Gate #2 — escalate only the days below 50% of their weekday average.
    // Days between 50% and 60% are on the dashboard but are not worth
    // interrupting an owner's morning over; see lib/revenue/slow-days.ts.
    const slowDays = await detectSlowDaysForTenant(drizzleSlowDayStore, tenant.id);
    const slowDayAlerts = slowDayAlertLines(slowDays.criticalSlowDays);
    if (slowDayAlerts.length > 0) alerted++;

    console.log(
      `[Daily Brief] Tenant ${tenant.name}: ${msgCount.count} msgs (24h), ${bookingCount.count} bookings (24h), ${slowDays.slowDays.length} slow day(s).`
    );

    const waAccount = await db.query.waAccounts.findFirst({
      where: and(eq(waAccounts.tenantId, tenant.id), eq(waAccounts.isConnected, true)),
    });
    if (!waAccount?.phoneNumber) continue;

    const text = [
      `Good morning! Here's your Gemino brief for ${tenant.name}:`,
      `💬 ${msgCount.count} WhatsApp message(s) in the last 24h`,
      `📅 ${bookingCount.count} reservation(s) in the last 24h`,
      ...slowDayAlerts,
    ].join('\n');

    await db.insert(jobs).values({
      tenantId: tenant.id,
      type: 'send_whatsapp',
      payload: { waAccountId: waAccount.id, to: waAccount.phoneNumber, text },
      status: 'pending',
      nextRunAt: new Date(),
    });
    briefed++;
  }

  return NextResponse.json({
    ok: true,
    tenantsChecked: allTenants.length,
    tenantsBriefed: briefed,
    tenantsWithSlowDayAlert: alerted,
  });
}

