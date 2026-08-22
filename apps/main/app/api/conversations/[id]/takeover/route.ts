import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db, initDb } from '@/lib/db';
import { conversations } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await initDb();
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const manualTakeover = body.manualTakeover !== false;

  const [updated] = await db
    .update(conversations)
    .set({ manualTakeover })
    .where(and(eq(conversations.id, params.id), eq(conversations.tenantId, tenant.id)))
    .returning();

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, manualTakeover: updated.manualTakeover });
}
