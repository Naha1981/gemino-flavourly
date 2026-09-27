import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { requireTenantRole } from '@/lib/auth/tenant-role';
import { db } from '@/lib/db';
import { staffMembers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireTenantRole(tenant.id, 'manager'); } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  const staff = await db.select({
    id: staffMembers.id, name: staffMembers.name, email: staffMembers.email,
    role: staffMembers.role, clerkUserId: staffMembers.clerkUserId, createdAt: staffMembers.createdAt,
  }).from(staffMembers).where(eq(staffMembers.tenantId, tenant.id)).orderBy(staffMembers.createdAt);
  return NextResponse.json({ staff });
}
