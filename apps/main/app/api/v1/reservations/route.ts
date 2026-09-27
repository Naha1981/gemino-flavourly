import { NextResponse } from 'next/server';
import { authenticatePublicApi } from '@/lib/api/public-api';
import { db } from '@/lib/db';
import { reservations } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(req: Request) {
  try {
    const ctx = await authenticatePublicApi(req);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(req.url); const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
    const rows = await db.select({
      id: reservations.id, customerName: reservations.customerName, date: reservations.date,
      partySize: reservations.partySize, status: reservations.status, deposit: reservations.deposit,
    }).from(reservations).where(eq(reservations.tenantId, ctx.tenantId)).orderBy(desc(reservations.date)).limit(limit);
    return NextResponse.json({ data: rows });
  } catch (error) {
    if (error instanceof Error && error.message === 'RATE_LIMITED') return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    return NextResponse.json({ error: 'API error' }, { status: 500 });
  }
}
