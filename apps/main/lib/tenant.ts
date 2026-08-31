import { auth, clerkClient } from '@clerk/nextjs/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { tenants, waAccounts, memberships } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

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
/**
 * S4 — make sure a user has an 'owner' membership row for a tenant they
 * own. Idempotent (unique (user_id, tenant_id) + onConflictDoNothing); used
 * to backfill memberships for tenants created before the memberships model
 * existed, so the resolver and switcher agree everywhere.
 */
export async function ensureOwnerMembership(userId: string, tenantId: string): Promise<void> {
  await db
    .insert(memberships)
    .values({ userId, tenantId, role: 'owner' })
    .onConflictDoNothing()
    .catch((err: unknown) => {
      console.error('[getOrCreateTenant] Failed to backfill owner membership.', err);
    });
}

/**
 * Does this user actually have a grant on this tenant — an owner column
 * (owner_user_id / legacy owner_id), a memberships row, or a matching
 * owner_email from the self-signup flow?
 *
 * getOrCreateTenant used to return the metadata tenant UNCONDITIONALLY and
 * even auto-insert an 'owner' membership for it. Clerk publicMetadata is
 * only writable server-side, so this is not an outsider attack vector — but
 * it is a revocation hole: the moment an operator revokes a user's access
 * (deletes the membership, clears the owner columns, reassigns the tenant),
 * the user's NEXT request here silently re-created the 'owner' membership
 * from the stale metadata and restored full owner access. The grant tables
 * are the authorization source of truth; metadata is only a lookup hint.
 */
async function userHasTenantGrant(
  userId: string,
  tenant: { id: string; ownerUserId: string | null; ownerId: string | null; ownerEmail: string | null },
  email: string
): Promise<boolean> {
  if (tenant.ownerUserId === userId || tenant.ownerId === userId) return true;
  if (tenant.ownerEmail && tenant.ownerEmail.toLowerCase() === email.toLowerCase()) return true;
  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.tenantId, tenant.id)),
  }).catch(() => undefined);
  return !!membership;
}

export async function getOrCreateTenant() {
  const { userId } = await auth();
  if (!userId) return null;

  const client = typeof clerkClient === 'function' ? await (clerkClient as any)() : clerkClient;
  const user = await client.users.getUser(userId).catch(() => null);
  const meta = ((user?.publicMetadata as any) || {}) as { tenantId?: string };
  const email = user?.emailAddresses?.[0]?.emailAddress || 'unknown';

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
    // Only return (and backfill a membership for) the metadata tenant when
    // the user actually holds a grant on it. Unconditional trust here made
    // revocation impossible: a revoked user's next request re-created the
    // 'owner' membership from the stale Clerk metadata.
    if (t && (await userHasTenantGrant(userId, t, email))) {
      await ensureOwnerMembership(userId, t.id);
      return t;
    }
  }

  const name = email.split('@')[0] || `Restaurant-${userId.slice(-4)}`;
  const slug = `t-${userId.slice(-8)}`;

  // Check if a tenant with this slug already exists, to avoid a unique
  // constraint violation on a retry (e.g. metadata update below failed
  // last time, so meta.tenantId wasn't set, but the tenant row was
  // already created). The slug is derived from THIS user's id, so a match
  // is normally their own recovery path — but it is only CLAIMED when a
  // real grant backs it. A slug occupied by someone else's tenant (an
  // improbable 8-char suffix collision) previously made this user its
  // OWNER; now it falls through to creating a distinct tenant instead.
  const [existingTenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1)
    .catch((err) => {
      console.error('[getOrCreateTenant] Failed to check for existing tenant by slug — is the DB schema in sync? Run GET /api/migrate while signed in as admin.', err);
      return [];
    });
  if (existingTenant && (await userHasTenantGrant(userId, existingTenant, email))) {
    await ensureOwnerMembership(userId, existingTenant.id);
    return existingTenant;
  }
  const uniqueSlug = existingTenant
    ? `${slug}-${randomUUID().slice(0, 4)}` // slug taken by a foreign tenant — pick a distinct one
    : slug;

  let tenant;
  try {
    [tenant] = await db.insert(tenants).values({ name, slug: uniqueSlug, ownerEmail: email }).returning();
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
    // S4 — stamp ownership + the owner membership so the tenant resolver and
    // the switcher treat self-signed-up tenants exactly like claimed ones.
    await db
      .update(tenants)
      .set({ ownerUserId: userId })
      .where(eq(tenants.id, tenant.id))
      .catch((err: unknown) => {
        console.error('[getOrCreateTenant] Failed to stamp owner_user_id.', err);
      });
    await db
      .insert(memberships)
      .values({ userId, tenantId: tenant.id, role: 'owner' })
      .onConflictDoNothing()
      .catch((err: unknown) => {
        console.error('[getOrCreateTenant] Failed to insert owner membership.', err);
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
