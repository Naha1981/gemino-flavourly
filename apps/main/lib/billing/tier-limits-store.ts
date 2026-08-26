import { and, eq, gte, count } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages, tenants } from '@/lib/db/schema';
import {
  checkTierSendAllowed,
  tierLimitBlockedMessage,
  type LimitDecision,
} from './tier-limits';

/**
 * Adapter that counts a tenant's recent outbound messages and applies the
 * tier gate. Used by the outbox dispatcher and the enqueue helpers so a
 * low-tier tenant cannot send beyond its plan.
 */
export async function evaluateTierLimit(tenantId: string): Promise<LimitDecision> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000);

  const [tenant] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return { allowed: true }; // fail open on a missing tenant row

  const plan = tenant.plan ?? 'starter';

  const [monthRow] = await db
    .select({ value: count() })
    .from(messages)
    .where(and(
      eq(messages.tenantId, tenantId),
      eq(messages.direction, 'outbound'),
      gte(messages.createdAt, monthStart)
    ));
  const [hourRow] = await db
    .select({ value: count() })
    .from(messages)
    .where(and(
      eq(messages.tenantId, tenantId),
      eq(messages.direction, 'outbound'),
      gte(messages.createdAt, hourStart)
    ));

  const monthlyUsed = Number(monthRow?.value ?? 0);
  const hourlyRecent = Number(hourRow?.value ?? 0);

  return checkTierSendAllowed(plan, { monthlyUsed, hourlyRecent });
}

/** Convenience for callers that only need a yes/no. */
export async function tierMaySend(tenantId: string): Promise<boolean> {
  const d = await evaluateTierLimit(tenantId);
  return d.allowed;
}

/** The banner text to surface when the tier gate is blocking sending. */
export async function tierBlockedMessage(tenantId: string): Promise<string | null> {
  const d = await evaluateTierLimit(tenantId);
  return d.allowed ? null : tierLimitBlockedMessage(d);
}
