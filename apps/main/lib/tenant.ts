import { auth, clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { tenants, waAccounts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function getOrCreateTenant() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await clerkClient.users.getUser(userId);
  const meta = (user.publicMetadata || {}) as { tenantId?: string };

  if (meta.tenantId) {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, meta.tenantId)).limit(1);
    if (t) return t;
  }

  const email = user.emailAddresses[0]?.emailAddress || 'unknown';
  const name = email.split('@')[0];
  const slug = `t-${userId.slice(-8)}`;

  const [tenant] = await db.insert(tenants).values({ name, slug }).returning();
  await db.insert(waAccounts).values({ tenantId: tenant.id });
  await clerkClient.users.updateUserMetadata(userId, {
    publicMetadata: { tenantId: tenant.id },
  });

  return tenant;
}
