import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { requireTenantRole } from '@/lib/auth/tenant-role';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { encryptSecret } from '@/lib/reputation/secret-box';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireTenantRole(tenant.id, 'manager'); } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  const result = await db.execute(sql`SELECT id, url, events, enabled, created_at FROM webhook_endpoints WHERE tenant_id = ${tenant.id} ORDER BY created_at DESC`);
  return NextResponse.json({ endpoints: (result as any).rows ?? result as any[] });
}

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireTenantRole(tenant.id, 'manager'); } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json().catch(() => ({}));
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
  const events = Array.isArray(body.events) && body.events.length ? body.events : ['*'];
  if (!url || !/^https:\/\//i.test(url)) return NextResponse.json({ error: 'HTTPS webhook URL required' }, { status: 400 });
  if (!secret) return NextResponse.json({ error: 'Webhook secret required' }, { status: 400 });

  let encrypted: string;
  try { encrypted = encryptSecret(secret); } catch { return NextResponse.json({ error: 'REPUTATION_ENCRYPTION_KEY is not configured' }, { status: 503 }); }
  const result = await db.execute(sql`
    INSERT INTO webhook_endpoints (tenant_id, url, secret_encrypted, events)
    VALUES (${tenant.id}, ${url}, ${encrypted}, ${JSON.stringify(events)}::jsonb)
    RETURNING id, url, events, enabled, created_at
  `);
  return NextResponse.json({ endpoint: ((result as any).rows?.[0] ?? (result as any)[0]) }, { status: 201 });
}
