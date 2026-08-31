import { db } from '@/lib/db';
import { waAccounts } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';

/**
 * Resolve the tenant's WhatsApp account row, provisioning it on demand.
 *
 * WHY THIS EXISTS: only tenants created AFTER lib/tenant.ts learned to
 * insert a wa_accounts row have one. Older tenants (including the
 * platform owner's own, created 2026-08-21) 404'd out of the QR linking
 * flow entirely — /api/whatsapp/status and /connect both refused to
 * proceed, so the dashboard could never even display a code to scan.
 * The linking flow needs exactly one row per tenant, so it is created
 * here on first use instead of requiring a backfill migration.
 *
 * RACE SAFETY: two concurrent first-requests can both observe "no row"
 * and both insert (the neon-http driver cannot run interactive
 * transactions, and wa_accounts.tenant_id has no unique constraint).
 * Both rows belong to the same tenant, so readers converge by always
 * resolving the OLDEST row — deterministically, in every caller.
 */
export async function ensureWaAccount(tenantId: string) {
  const existing = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.tenantId, tenantId))
    .orderBy(asc(waAccounts.createdAt), asc(waAccounts.id))
    .limit(1);
  if (existing.length > 0) {
    return existing[0];
  }

  await db.insert(waAccounts).values({ tenantId }).catch((err: unknown) => {
    console.error('[ensureWaAccount] Failed to provision wa_accounts row.', err);
  });

  // Re-read (oldest first) — picks up either our insert or a concurrent
  // request's, and stays deterministic if both landed.
  const [resolved] = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.tenantId, tenantId))
    .orderBy(asc(waAccounts.createdAt), asc(waAccounts.id))
    .limit(1);
  return resolved ?? null;
}
