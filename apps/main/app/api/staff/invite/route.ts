import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { getOrCreateTenant } from '@/lib/tenant';
import { requireTenantRole } from '@/lib/auth/tenant-role';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  const { userId } = await auth();
  if (!tenant || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireTenantRole(tenant.id, 'manager'); } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = body.role === 'manager' ? 'manager' : 'staff';
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'Valid email required' }, { status: 400 });

  const rawToken = randomBytes(24).toString('base64url');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expires = new Date(Date.now() + 7 * 86400000);
  await db.execute(sql`INSERT INTO staff_invites (tenant_id,email,role,token_hash,expires_at,created_by) VALUES (${tenant.id},${email},${role},${tokenHash},${expires},${userId})`);
  return NextResponse.json({ ok: true, inviteUrl: `/staff/invite/${rawToken}`, expiresAt: expires });
}
