import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { waitlistEntries } from '@/lib/db/schema';
import { and, eq, lt } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Expire offered waitlist entries that were not accepted within 15 minutes
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

  const expired = await db
    .update(waitlistEntries)
    .set({ status: 'expired' })
    .where(
      and(
        eq(waitlistEntries.status, 'offered'),
        lt(waitlistEntries.notifiedAt, fifteenMinutesAgo)
      )
    )
    .returning();

  return NextResponse.json({ ok: true, expiredCount: expired.length });
}
