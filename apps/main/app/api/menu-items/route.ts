import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getCurrentTenantRole, requireTenantRole } from '@/lib/auth/tenant-role';
import { ensureMenuItems, listMenuItems } from '@/lib/menu/menu-store';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const items = await ensureMenuItems(tenant.id, tenant.menuText);
  return NextResponse.json({ items, role: await getCurrentTenantRole(tenant.id) });
}

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireTenantRole(tenant.id, 'manager'); } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const max = await db.execute(sql`SELECT COALESCE(MAX(position), -1) AS max FROM menu_items WHERE tenant_id = ${tenant.id}`);
  const position = Number(((max as any).rows?.[0] ?? (max as any)[0])?.max ?? -1) + 1;
  const priceCents = body.priceCents == null ? null : Math.max(0, Number(body.priceCents));
  const result = await db.execute(sql`
    INSERT INTO menu_items (tenant_id, name, category, description, price_cents, available, position)
    VALUES (${tenant.id}, ${name}, ${typeof body.category === 'string' ? body.category.trim() : null},
            ${typeof body.description === 'string' ? body.description.trim() : null},
            ${Number.isFinite(priceCents) ? priceCents : null}, true, ${position})
    RETURNING id, name, category, description, price_cents, available, position
  `);
  return NextResponse.json({ item: ((result as any).rows?.[0] ?? (result as any)[0]) }, { status: 201 });
}
