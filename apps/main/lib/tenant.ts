import { auth, clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { tenants, waAccounts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function getOrCreateTenant() {
  const { userId } = await auth();
  if (!userId) return null;

  const client = typeof clerkClient === 'function' ? await (clerkClient as any)() : clerkClient;
  const user = await client.users.getUser(userId).catch(() => null);
  const meta = ((user?.publicMetadata as any) || {}) as { tenantId?: string };

  if (meta.tenantId) {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, meta.tenantId)).limit(1).catch(() => []);
    if (t) return t;
  }

  const email = user?.emailAddresses?.[0]?.emailAddress || 'unknown';
  const name = email.split('@')[0] || `Restaurant-${userId.slice(-4)}`;
  const slug = `t-${userId.slice(-8)}`;

  // Check if tenant with this slug already exists to prevent unique constraint violation
  const [existingTenant] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1).catch(() => []);
  if (existingTenant) {
    return existingTenant;
  }

  const [tenant] = await db.insert(tenants).values({ name, slug, ownerEmail: email }).returning();
  if (tenant) {
    await db.insert(waAccounts).values({ tenantId: tenant.id }).catch(() => null);
    if (client?.users?.updateUserMetadata) {
      await client.users.updateUserMetadata(userId, {
        publicMetadata: { tenantId: tenant.id },
      }).catch(() => null);
    }
  }

  return tenant;
}
