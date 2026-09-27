import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { requireTenantRole } from '@/lib/auth/tenant-role';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireTenantRole(tenant.id, 'owner'); } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  const { id } = await ctx.params;
  await db.execute(sql`UPDATE api_keys SET disabled = true WHERE id = ${id} AND tenant_id = ${tenant.id}`);
  return NextResponse.json({ ok: true });
}
