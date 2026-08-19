import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tenants, messages, reservations, waitlistEntries, jobs, waAccounts } from '@/lib/db/schema';
import { eq, sql, and } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Morning brief for restaurant owners (e.g. 7 AM daily)
  const allTenants = await db.query.tenants.findMany({
    where: eq(tenants.aiEnabled, true),
  });

  for (const tenant of allTenants) {
    if (!tenant.ownerEmail) continue;

    // Aggregate yesterday's counts
    const [msgCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.tenantId, tenant.id));

    const [bookingCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(reservations)
      .where(eq(reservations.tenantId, tenant.id));

    // You can send this summary to the owner's WhatsApp number or Slack/Email
    console.log(`[Daily Brief] Tenant ${tenant.name}: ${msgCount.count} msgs, ${bookingCount.count} bookings.`);
  }

  return NextResponse.json({ ok: true, tenantsBriefed: allTenants.length });
}
