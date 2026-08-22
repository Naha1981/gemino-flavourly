import { db, initDb } from '@/lib/db';
import { tenants, waAccounts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getSessionUser } from '@/lib/auth/session';
import { isDemoMode, DEMO_TENANT_SLUG } from '@/lib/config';

export async function getOrCreateTenant() {
  await initDb();

  const session = await getSessionUser();
  if (!session) return null;

  if (isDemoMode()) {
    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, DEMO_TENANT_SLUG)).limit(1);
    if (demo) return demo;
  }

  if (!session.isDemo) {
    try {
      const { clerkClient } = await import('@clerk/nextjs/server');
      const client = typeof clerkClient === 'function' ? await (clerkClient as any)() : clerkClient;
      const user = await client.users.getUser(session.userId).catch(() => null);
      const meta = ((user?.publicMetadata as any) || {}) as { tenantId?: string };
      if (meta.tenantId) {
        const [t] = await db.select().from(tenants).where(eq(tenants.id, meta.tenantId)).limit(1);
        if (t) return t;
      }
    } catch (err) {
      console.error('[getOrCreateTenant] Clerk metadata lookup failed', err);
    }
  }

  const email = session.email || 'unknown';
  const name = session.firstName || email.split('@')[0] || `Restaurant-${session.userId.slice(-4)}`;
  const slug = `t-${session.userId.slice(-8).toLowerCase()}`;

  const [existingTenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1)
    .catch(() => []);
  if (existingTenant) return existingTenant;

  let tenant;
  try {
    [tenant] = await db.insert(tenants).values({ name, slug, ownerEmail: email }).returning();
  } catch (err) {
    console.error('[getOrCreateTenant] Failed to create tenant row.', err);
    return null;
  }

  if (tenant) {
    await db.insert(waAccounts).values({ tenantId: tenant.id }).catch((err: unknown) => {
      console.error('[getOrCreateTenant] Failed to create WhatsApp account row.', err);
    });

    if (!session.isDemo) {
      try {
        const { clerkClient } = await import('@clerk/nextjs/server');
        const client = typeof clerkClient === 'function' ? await (clerkClient as any)() : clerkClient;
        if (client?.users?.updateUserMetadata) {
          await client.users.updateUserMetadata(session.userId, {
            publicMetadata: { tenantId: tenant.id },
          });
        }
      } catch (err) {
        console.error('[getOrCreateTenant] Failed to stamp Clerk metadata', err);
      }
    }
  }

  return tenant ?? null;
}
