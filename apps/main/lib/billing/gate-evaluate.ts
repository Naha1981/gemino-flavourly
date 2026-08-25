import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decideBillingGate, type BillingGateResult } from './gate';

/**
 * Evaluate the billing gate for a tenant by reading its row. Never throws: a
 * missing tenant or error resolves to denied (fail closed).
 */
export async function evaluateBillingGate(tenantId: string): Promise<BillingGateResult> {
  try {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });
    if (!tenant) {
      return decideBillingGate(null);
    }
    return decideBillingGate({
      planStatus: tenant.planStatus,
      trialEndsAt: tenant.trialEndsAt,
      payfastSubscriptionToken: tenant.payfastSubscriptionToken,
    });
  } catch (err) {
    console.error(`[BillingGate] Error evaluating tenant ${tenantId}:`, err);
    return decideBillingGate(null);
  }
}

/**
 * Convenience predicate for enforcement points. Returns true when sending is
 * permitted. Super admin override is handled by callers passing isSuperAdmin.
 */
export async function canSendAutomatedMessages(
  tenantId: string,
  isSuperAdmin = false
): Promise<boolean> {
  if (isSuperAdmin) return true;
  const gate = await evaluateBillingGate(tenantId);
  return gate.allowed;
}
