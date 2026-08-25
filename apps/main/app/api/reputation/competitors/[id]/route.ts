import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { competitors } from '@/lib/db/schema';
import { getOrCreateTenant } from '@/lib/tenant';
import { getRatingHistory } from '@/lib/reputation/competitor-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [competitor] = await db.select().from(competitors).where(and(eq(competitors.id, params.id), eq(competitors.tenantId, tenant.id))).limit(1);
  if (!competitor) return NextResponse.json({ error: 'Competitor not found' }, { status: 404 });
  return NextResponse.json({ competitor, history: await getRatingHistory(competitor.id) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const deleted = await db.delete(competitors).where(and(eq(competitors.id, params.id), eq(competitors.tenantId, tenant.id))).returning({ id: competitors.id });
  if (!deleted.length) return NextResponse.json({ error: 'Competitor not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
