import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tenants, messages, reservations, jobs, waAccounts } from '@/lib/db/schema';
import { eq, sql, and, gte } from 'drizzle-orm';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { detectSlowDaysForTenant, slowDayAlertLines } from '@/lib/revenue/slow-days';
import { drizzleSlowDayStore } from '@/lib/revenue/slow-days-store';
import { buildTenantPriorities } from '@/lib/revenue/priorities';
import { drizzlePriorityStore } from '@/lib/revenue/priorities-store';
import { buildTenantOpportunity } from '@/lib/revenue/opportunity';
import { drizzleOpportunityStore } from '@/lib/revenue/opportunity-store';

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
  let prioritized = 0;

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

    // Gate #5 — the single most worthwhile action today, ranked across
    // missed enquiries, critical slow days, pending cancellations and
    // pending no-shows. Reuses the slow-day report from the Gate #2 call
    // above (one reservation scan, two uses) so the brief's top action and
    // its slow-day alert can never disagree about the week.
    const topPriorities = await buildTenantPriorities(drizzlePriorityStore, tenant.id, slowDays);
    const topPriority = topPriorities[0];
    if (topPriority) prioritized++;

    // Gate #6 — the bottom line: everything the owner can still recover
    // this month, in one line. Reuses the same Gate #2 report as the
    // slow-day alert and the top action, so one reservation scan feeds
    // all three surfaces without disagreement.
    const opportunity = await buildTenantOpportunity(drizzleOpportunityStore, tenant.id, slowDays);

    console.log(
      `[Daily Brief] Tenant ${tenant.name}: ${msgCount.count} msgs (24h), ${bookingCount.count} bookings (24h), ${slowDays.slowDays.length} slow day(s), top action: ${topPriority ? topPriority.opportunity_type : 'none'}.`
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
      ...(topPriority ? [`🎯 Today's top action: ${topPriority.description}`] : []),
      `💰 You have R${Math.round(opportunity.total_opportunity_cents / 100)} in potential revenue on the table this month. Expected recovery: R${Math.round(opportunity.expected_recovery_cents / 100)}.`,
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
    tenantsWithTopPriority: prioritized,
  });
}

