import { auth, clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { tenants, waAccounts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Resolves the signed-in Clerk user to their tenant row, creating one
 * (plus its WhatsApp account row) on first login.
 *
 * The tenant-creation INSERT below used to be unguarded. If the live
 * Neon schema is missing a column that the Drizzle schema knows about
 * (e.g. the migration in /api/migrate was never run against this
 * database), Postgres throws a "column does not exist" error on the
 * INSERT's implicit RETURNING clause, and — because nothing here caught
 * it — that error propagated straight up into whatever page called this
 * function, crashing it with an unhandled 500 ("Application error").
 * Every write path here is now guarded, and failures return `null`
 * instead of throwing, so callers can render a real fallback instead of
 * a blank crash.
 */
export async function getOrCreateTenant() {
  const { userId } = await auth();
  if (!userId) return null;

  const client = typeof clerkClient === 'function' ? await (clerkClient as any)() : clerkClient;
  const user = await client.users.getUser(userId).catch(() => null);
  const meta = ((user?.publicMetadata as any) || {}) as { tenantId?: string };

  if (meta.tenantId) {
    const [t] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, meta.tenantId))
      .limit(1)
      .catch((err) => {
        console.error('[getOrCreateTenant] Failed to look up tenant by id — is the DB schema in sync? Run GET /api/migrate while signed in as admin.', err);
        return [];
      });
    if (t) return t;
  }

  const email = user?.emailAddresses?.[0]?.emailAddress || 'unknown';
  const name = email.split('@')[0] || `Restaurant-${userId.slice(-4)}`;
  const slug = `t-${userId.slice(-8)}`;

  // Check if a tenant with this slug already exists, to avoid a unique
  // constraint violation on a retry (e.g. metadata update below failed
  // last time, so meta.tenantId wasn't set, but the tenant row was
  // already created).
  const [existingTenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1)
    .catch((err) => {
      console.error('[getOrCreateTenant] Failed to check for existing tenant by slug — is the DB schema in sync? Run GET /api/migrate while signed in as admin.', err);
      return [];
    });
  if (existingTenant) {
    return existingTenant;
  }

  let tenant;
  try {
    [tenant] = await db.insert(tenants).values({ name, slug, ownerEmail: email }).returning();
  } catch (err) {
    console.error(
      '[getOrCreateTenant] Failed to create tenant row. This almost always means the Neon database schema is out of date. Sign in as the admin and hit GET /api/migrate, then try again.',
      err
    );
    return null;
  }

  if (tenant) {
    await db.insert(waAccounts).values({ tenantId: tenant.id }).catch((err: unknown) => {
      console.error('[getOrCreateTenant] Tenant created, but failed to create its WhatsApp account row.', err);
    });
    if (client?.users?.updateUserMetadata) {
      await client.users
        .updateUserMetadata(userId, { publicMetadata: { tenantId: tenant.id } })
        .catch((err: unknown) => {
          console.error('[getOrCreateTenant] Tenant created, but failed to stamp tenantId onto Clerk user metadata. Subsequent logins will re-resolve by slug instead of the fast metadata path.', err);
        });
    }
  }

  return tenant ?? null;
}
