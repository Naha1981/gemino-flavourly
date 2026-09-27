import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { requireTenantRole } from '@/lib/auth/tenant-role';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireTenantRole(tenant.id, 'manager'); } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const allowed = ['name','category','description','priceCents','available','position'] as const;
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body.name === 'string') { sets.push('name = ?'); values.push(body.name.trim()); }
  if (typeof body.category === 'string' || body.category === null) { sets.push('category = ?'); values.push(body.category); }
  if (typeof body.description === 'string' || body.description === null) { sets.push('description = ?'); values.push(body.description); }
  if (typeof body.priceCents === 'number' || body.priceCents === null) { sets.push('price_cents = ?'); values.push(body.priceCents); }
  if (typeof body.available === 'boolean') { sets.push('available = ?'); values.push(body.available); }
  if (typeof body.position === 'number') { sets.push('position = ?'); values.push(body.position); }
  void allowed;
  if (sets.length === 0) return NextResponse.json({ error: 'No changes' }, { status: 400 });

  // Drizzle SQL templates are used instead of string-interpolated SQL.
  // Rebuild the statement using explicit nullable branches to keep values parameterized.
  const current = await db.execute(sql`SELECT * FROM menu_items WHERE id = ${id} AND tenant_id = ${tenant.id} LIMIT 1`);
  if (!((current as any).rows ?? current as any[]).length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await db.execute(sql`
    UPDATE menu_items SET
      name = COALESCE(${typeof body.name === 'string' ? body.name.trim() : null}, name),
      category = CASE WHEN ${Object.prototype.hasOwnProperty.call(body,'category')} THEN ${body.category} ELSE category END,
      description = CASE WHEN ${Object.prototype.hasOwnProperty.call(body,'description')} THEN ${body.description} ELSE description END,
      price_cents = CASE WHEN ${Object.prototype.hasOwnProperty.call(body,'priceCents')} THEN ${body.priceCents} ELSE price_cents END,
      available = CASE WHEN ${Object.prototype.hasOwnProperty.call(body,'available')} THEN ${body.available} ELSE available END,
      position = CASE WHEN ${typeof body.position === 'number'} THEN ${body.position} ELSE position END,
      updated_at = NOW()
    WHERE id = ${id} AND tenant_id = ${tenant.id}
  `);
  const updated = await db.execute(sql`SELECT id, name, category, description, price_cents, available, position FROM menu_items WHERE id = ${id} AND tenant_id = ${tenant.id}`);
  return NextResponse.json({ item: ((updated as any).rows?.[0] ?? (updated as any)[0]) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireTenantRole(tenant.id, 'manager'); } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  const { id } = await ctx.params;
  await db.execute(sql`DELETE FROM menu_items WHERE id = ${id} AND tenant_id = ${tenant.id}`);
  return NextResponse.json({ ok: true });
}
