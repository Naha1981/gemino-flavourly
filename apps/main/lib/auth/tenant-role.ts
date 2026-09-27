import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { staffMembers, memberships, tenants } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export type TenantRole = 'owner' | 'manager' | 'staff' | 'none';
const rank: Record<TenantRole, number> = { none: 0, staff: 1, manager: 2, owner: 3 };

export async function getCurrentTenantRole(tenantId: string): Promise<TenantRole> {
  const { userId } = await auth();
  if (!userId) return 'none';

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { ownerUserId: true, ownerId: true },
  });
  if (!tenant) return 'none';
  if (tenant.ownerUserId === userId || tenant.ownerId === userId) return 'owner';

  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)),
  }).catch(() => null);
  const staff = await db.query.staffMembers.findFirst({
    where: and(eq(staffMembers.clerkUserId, userId), eq(staffMembers.tenantId, tenantId)),
  }).catch(() => null);

  if (staff?.role === 'manager') return 'manager';
  if (staff?.role === 'staff' || membership?.role === 'staff') return 'staff';
  return 'none';
}

export async function requireTenantRole(tenantId: string, required: Exclude<TenantRole, 'none'>): Promise<TenantRole> {
  const role = await getCurrentTenantRole(tenantId);
  if (rank[role] < rank[required]) throw new Error('FORBIDDEN');
  return role;
}
