import { auth } from '@clerk/nextjs/server';
import { cookies, headers } from 'next/headers';
import { db } from '@/lib/db';
import { tenants, memberships } from '@/lib/db/schema';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import {
  ACTIVE_TENANT_COOKIE,
  TENANT_PARAM_HEADER,
  decideTenantId,
  isUuidLike,
  type ResolutionDecision,
  type TenantSource,
} from './tenant-resolver-core.ts';

export { ACTIVE_TENANT_COOKIE, TENANT_PARAM_HEADER, decideTenantId, isUuidLike };
export type { ResolutionDecision, TenantSource };

/**
 * S4 — Multi-tenant resolution.
 *
 * One place decides WHICH tenant a signed-in user is "in" right now, in
 * strict priority order:
 *
 *   1. `?tenant=<id>`  — explicit deep-link / switch (forwarded from
 *      middleware as the `x-tenant-param` request header, because App
 *      Router layouts never receive searchParams);
 *   2. `flavourly_active_tenant` cookie — sticky selection set by claim
 *      redeem (S2) and POST /api/tenant/switch;
 *   3. owned / membership tenants (tenants.owner_user_id, legacy
 *      tenants.owner_id, or a memberships row) — oldest first, so a
 *      single-tenant owner always resolves deterministically;
 *   4. super-admin default — the platform's oldest tenant, so platform
 *      operators land somewhere useful instead of onboarding themselves.
 *
 * ISOLATION GUARD: a tenant id coming from ?tenant= or the cookie is only
 * honoured when the caller actually manages that tenant (or is a super
 * admin). An id the caller has no grant for is silently discarded and
 * resolution falls through to the next source — a guessed/enumerated id
 * must never resolve into someone else's data.
 */

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  [key: string]: unknown;
}

export interface ResolvedTenant {
  tenant: TenantRow;
  source: TenantSource;
}

/**
 * All tenants the user may act in: owned via owner_user_id / legacy
 * owner_id, or granted via a memberships row. Oldest first.
 */
export async function listManagedTenants(userId: string): Promise<TenantRow[]> {
  const [owned, memberRows] = await Promise.all([
    db
      .select()
      .from(tenants)
      .where(or(eq(tenants.ownerUserId, userId), eq(tenants.ownerId, userId)))
      .catch((err) => {
        console.error('[tenant-resolver] owned-tenant lookup failed', err);
        return [] as (typeof tenants.$inferSelect)[];
      }),
    db
      .select({ tenantId: memberships.tenantId })
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .catch((err) => {
        console.error('[tenant-resolver] membership lookup failed', err);
        return [] as { tenantId: string }[];
      }),
  ]);

  const memberIds = Array.from(new Set(memberRows.map((m) => m.tenantId))).filter(
    (id) => !owned.some((t) => t.id === id)
  );

  let memberTenants: (typeof tenants.$inferSelect)[] = [];
  if (memberIds.length > 0) {
    memberTenants = await db
      .select()
      .from(tenants)
      .where(inArray(tenants.id, memberIds))
      .catch((err) => {
        console.error('[tenant-resolver] membership-tenant lookup failed', err);
        return [] as (typeof tenants.$inferSelect)[];
      });
  }

  return [...owned, ...memberTenants]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((t) => t as unknown as TenantRow);
}

/** Direct lookup of one tenant (super-admin cross-tenant path). */
export async function findTenantById(tenantId: string): Promise<TenantRow | null> {
  if (!isUuidLike(tenantId)) return null;
  const [t] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
    .catch((err) => {
      console.error('[tenant-resolver] tenant lookup failed', err);
      return [] as (typeof tenants.$inferSelect)[];
    });
  return (t as unknown as TenantRow) ?? null;
}

export interface ResolveOptions {
  /** Explicit override (e.g. from a page that DOES receive searchParams). */
  tenantParam?: string | null;
}

/**
 * Resolve the active tenant for the signed-in user. Returns null when there
 * is no session or nothing resolvable (caller decides whether to create a
 * fresh tenant or bounce to sign-in).
 */
export async function resolveActiveTenant(opts: ResolveOptions = {}): Promise<ResolvedTenant | null> {
  const { userId } = await auth();
  if (!userId) return null;

  // ?tenant= priority: prefer the explicit option; otherwise read the
  // header middleware forwarded (layouts never get searchParams).
  let tenantParam = opts.tenantParam ?? null;
  if (!tenantParam) {
    try {
      tenantParam = headers().get(TENANT_PARAM_HEADER);
    } catch {
      // headers() unavailable outside a request scope (unit contexts).
      tenantParam = null;
    }
  }

  let cookieTenantId: string | null = null;
  try {
    cookieTenantId = cookies().get(ACTIVE_TENANT_COOKIE)?.value ?? null;
  } catch {
    cookieTenantId = null;
  }

  const superAdmin = await isSuperAdmin().catch(() => false);
  const managed = await listManagedTenants(userId);

  let defaultId: string | null = null;
  if (superAdmin) {
    const [oldest] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .orderBy(asc(tenants.createdAt))
      .limit(1)
      .catch(() => [] as { id: string }[]);
    defaultId = oldest?.id ?? null;
  }

  const decision = decideTenantId({
    queryTenantId: tenantParam,
    cookieTenantId,
    managedIds: managed.map((t) => t.id),
    defaultId,
    isSuperAdmin: superAdmin,
  });

  if (!decision) return null;

  const fromManaged = managed.find((t) => t.id === decision.tenantId);
  if (fromManaged) return { tenant: fromManaged, source: decision.source };

  // Super-admin cross-tenant selection (?tenant= or cookie pointing at a
  // tenant they don't own — an intentional operator action, audited via
  // source).
  const tenant = await findTenantById(decision.tenantId);
  if (!tenant) return null;
  return { tenant, source: decision.source };
}

/**
 * Authorization check used by POST /api/tenant/switch: can this user act in
 * this tenant? Managed tenants always; anything else only for super admins.
 */
export async function canManageTenant(userId: string, tenantId: string): Promise<boolean> {
  if (!isUuidLike(tenantId)) return false;
  if (await isSuperAdmin().catch(() => false)) return true;
  const managed = await listManagedTenants(userId);
  return managed.some((t) => t.id === tenantId);
}
