import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { requireTenantRole } from '@/lib/auth/tenant-role';
import { createApiKey } from '@/lib/api/public-api';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireTenantRole(tenant.id, 'owner'); } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  const result = await db.execute(sql`SELECT id, name, key_prefix, disabled, last_used_at, created_at FROM api_keys WHERE tenant_id = ${tenant.id} ORDER BY created_at DESC`);
  return NextResponse.json({ keys: (result as any).rows ?? result as any[] });
}

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireTenantRole(tenant.id, 'owner'); } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  const body = await req.json().catch(() => ({}));
  const created = await createApiKey(tenant.id, typeof body.name === 'string' ? body.name : 'API key');
  return NextResponse.json({ key: created }, { status: 201 });
}
