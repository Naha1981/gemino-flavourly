import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tenants, waAccounts, jobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { listVipAlertsToday } from '@/lib/customer/vip-store';
import { buildVipDailyBrief, type VipAlertSummaryItem } from '@/lib/customer/vip-daily-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * VIP alerts — daily 07:00 brief (Engine 2).
 *
 * Scheduled at 07:00 via cron-job.org. For every tenant, read today's VIP
 * alerts (raised by the webhook when a VIP walks in) and send a staff-facing
 * morning brief over WhatsApp, so staff see who's in today and what to do.
 *
 * Guarded like every cron route. If a tenant has no connected WhatsApp, the
 * summary is logged only (never invent a send path).
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
  const summaries: Array<{ tenantId: string; line: string; count: number; sent: boolean }> = [];

  for (const tenant of tenantsRows) {
    const alerts = await listVipAlertsToday(tenant.id, 200);
    const today: VipAlertSummaryItem[] = alerts.map((a) => ({
      customerName: a.customerName,
      customerPhone: a.customerPhone,
      totalVisits: a.totalVisits,
      totalSpendCents: a.totalSpendCents,
      servedAt: a.servedAt ?? null,
    }));

    const brief = buildVipDailyBrief({ tenantName: tenant.name, today, now: new Date() });
    if (brief.count === 0) {
      summaries.push({ tenantId: tenant.id, line: brief.line, count: 0, sent: false });
      continue;
    }

    const senderRows = await db
      .select({ id: waAccounts.id, phoneNumber: waAccounts.phoneNumber })
      .from(waAccounts)
      .where(eq(waAccounts.tenantId, tenant.id))
      .limit(1);
    // Drizzle .limit(1) returns an ARRAY — take the first row before reading .id.
    const sender = senderRows[0];

    if (!sender?.id) {
      summaries.push({ tenantId: tenant.id, line: brief.line, count: brief.count, sent: false });
      console.log(`[vip-brief] ${brief.line}`);
      continue;
    }

    await db
      .insert(jobs)
      .values({
        tenantId: tenant.id,
        type: 'send_whatsapp',
        payload: { waAccountId: sender.id, to: sender.phoneNumber ?? '', text: brief.line },
        status: 'pending',
        maxAttempts: 5,
        nextRunAt: new Date(),
      })
      .catch((err) => console.error('[vip-brief] failed to queue summary', err));

    summaries.push({ tenantId: tenant.id, line: brief.line, count: brief.count, sent: true });
  }

  return NextResponse.json({ ok: true, briefed: summaries.filter((s) => s.sent).length, summaries });
}
