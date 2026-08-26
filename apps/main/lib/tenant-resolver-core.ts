/**
 * S4 — pure tenant-resolution decisions. Framework-free (no Next / Drizzle /
 * Clerk imports) so the priority order and the isolation guard are
 * unit-tested against the real logic. The I/O wrapper lives in
 * ./tenant-resolver.ts.
 */

/** Cookie carrying the sticky active tenant (set server-side only). */
export const ACTIVE_TENANT_COOKIE = 'flavourly_active_tenant';

/** Request header middleware uses to forward the ?tenant= param. */
export const TENANT_PARAM_HEADER = 'x-tenant-param';

export type TenantSource = 'query' | 'cookie' | 'membership' | 'super-admin-default';

export interface ResolutionDecision {
  tenantId: string;
  source: TenantSource;
}

/** Strict-ish UUID check (accepts the canonical 8-4-4-4-12 hex form). */
export function isUuidLike(value: string | null | undefined): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export interface DecideTenantInput {
  /** ?tenant= value (already URL-decoded). */
  queryTenantId?: string | null;
  /** flavourly_active_tenant cookie value. */
  cookieTenantId?: string | null;
  /** Tenant ids the caller manages, ordered oldest -> newest. */
  managedIds: string[];
  /** Platform default tenant id (oldest overall) for super admins. */
  defaultId?: string | null;
  isSuperAdmin: boolean;
}

/**
 * Pure resolution decision.
 *
 * Priority: ?tenant= -> cookie -> owned/membership -> super-admin default.
 *
 * ISOLATION GUARD: a tenant id from ?tenant= or the cookie is only honoured
 * when the caller manages it (or is a super admin). An id the caller has no
 * grant for is silently discarded and resolution falls through — a guessed
 * or enumerated id must never resolve into someone else's data.
 */
export function decideTenantId(input: DecideTenantInput): ResolutionDecision | null {
  const managed = new Set(input.managedIds);
  const canAccess = (id: string) => managed.has(id) || input.isSuperAdmin;

  // 1. Explicit ?tenant= deep-link.
  if (isUuidLike(input.queryTenantId) && canAccess(input.queryTenantId)) {
    return { tenantId: input.queryTenantId, source: 'query' };
  }

  // 2. Sticky cookie selection.
  if (isUuidLike(input.cookieTenantId) && canAccess(input.cookieTenantId)) {
    return { tenantId: input.cookieTenantId, source: 'cookie' };
  }

  // 3. Owned / membership tenants, oldest first (deterministic).
  if (input.managedIds.length > 0) {
    return { tenantId: input.managedIds[0], source: 'membership' };
  }

  // 4. Super-admin platform default.
  if (input.isSuperAdmin && isUuidLike(input.defaultId)) {
    return { tenantId: input.defaultId, source: 'super-admin-default' };
  }

  return null;
}
