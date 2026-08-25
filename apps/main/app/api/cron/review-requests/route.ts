import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { waAccounts } from '@/lib/db/schema';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { operatorClient } from '@/lib/operator-client';
import { buildReviewRequestMessage } from '@/lib/reputation/review-request';
import { getEligibleReservations, getGoogleReviewLink, markRequestSent } from '@/lib/reputation/review-request-store';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;
  const tenants = await db.query.tenants.findMany({ where: (table, { eq }) => eq(table.aiEnabled, true) });
  let sent = 0;
  let skipped = 0;
  for (const tenant of tenants) {
    const link = await getGoogleReviewLink(tenant.id);
    if (!link) continue;
    const account = await db.query.waAccounts.findFirst({ where: and(eq(waAccounts.tenantId, tenant.id), eq(waAccounts.isConnected, true)) });
    if (!account) continue;
    for (const { reservation, contact } of await getEligibleReservations(tenant.id)) {
      const phone = reservation.customerPhone || contact?.phone;
      if (!phone) { skipped++; continue; }
      const result = await operatorClient.sendMessage(tenant.id, account.id, phone, buildReviewRequestMessage(reservation.customerName || contact?.name || 'there', link));
      if (result.success) { await markRequestSent(reservation.id); sent++; } else skipped++;
    }
  }
  return NextResponse.json({ ok: true, sent, skipped });
}
