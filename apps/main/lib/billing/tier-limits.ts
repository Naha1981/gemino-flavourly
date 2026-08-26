/**
 * Per-tier limits (Starter / Casual / Premium / Signature / Group).
 *
 * The PRD defines a monthly message allowance and a per-hour rate limit per
 * tier, and the outbox dispatcher must enforce them so a low-tier tenant
 * cannot send beyond its plan. This module is pure (no Drizzle/Next imports)
 * so the arithmetic is unit-testable; the adapter that counts a tenant's
 * recent messages lives in ./tier-limits-store.ts.
 *
 *   Starter  R499   500 msgs/mo   100 msgs/hour   Engines 1(+brief)+manual segments
 *   Casual   R1,499 2,000 msgs/mo 250 msgs/hour   Engines 1-3, 3 competitors
 *   Premium  R3,999 10,000 msgs/mo 500 msgs/hour  Engines 1-5, WhatsApp+Email
 *   Signature R7,999 50,000 msgs/mo 1,000 msgs/hour All engines, all channels
 *   Group    R19,999 Unlimited msgs  2,000 msgs/hour All, multi-location
 *
 * `group` (multi-location) is treated as unlimited monthly and high hourly.
 */

import type { PlanTier } from './provider';

export interface TierLimits {
  /** Monthly outbound message allowance (Infinity for Group). */
  monthlyMessages: number;
  /** Outbound messages per rolling hour. */
  hourlyRate: number;
  /** Max competitors that can be tracked (Casual = 3, etc.). Infinity for Group. */
  competitors: number;
  /** Engines included for the tier (1-based engine numbers). */
  engines: number[];
  /** Whether the tier gets the approval workflow (Signature+ only, per PRD). */
  approvalWorkflow: boolean;
}

export const TIER_LIMITS: Record<PlanTier, TierLimits> = {
  starter: {
    monthlyMessages: 500,
    hourlyRate: 100,
    competitors: 1,
    engines: [1],
    approvalWorkflow: false,
  },
  casual: {
    monthlyMessages: 2000,
    hourlyRate: 250,
    competitors: 3,
    engines: [1, 2, 3],
    approvalWorkflow: false,
  },
  premium: {
    monthlyMessages: 10000,
    hourlyRate: 500,
    competitors: 5,
    engines: [1, 2, 3, 4, 5],
    approvalWorkflow: false,
  },
  signature: {
    monthlyMessages: 50000,
    hourlyRate: 1000,
    competitors: 10,
    engines: [1, 2, 3, 4, 5, 6],
    approvalWorkflow: true,
  },
  group: {
    monthlyMessages: Infinity,
    hourlyRate: 2000,
    competitors: Infinity,
    engines: [1, 2, 3, 4, 5, 6],
    approvalWorkflow: true,
  },
};

/** The tier a tenant maps to; defaults to `starter` for an unrecognised plan. */
export function planToTier(plan: string | null | undefined): PlanTier {
  const p = (plan ?? 'starter').toLowerCase();
  return (['starter', 'casual', 'premium', 'signature', 'group'] as PlanTier[]).includes(p as PlanTier)
    ? (p as PlanTier)
    : 'starter';
}

export type LimitDecision =
  | { allowed: true }
  | { allowed: false; reason: 'monthly_quota_exceeded'; allowance: number; used: number }
  | { allowed: false; reason: 'hourly_rate_exceeded'; limit: number; recent: number };

/**
 * The core outbox gate: may this tenant send another outbound message?
 *
 * `monthlyUsed` and `hourlyRecent` are counts of already-queued/sent outbound
 * messages for the tenant. A tier is blocked only when BOTH its monthly
 * allowance and (for the hourly check) its rate limit are exceeded — so a
 * busy hour on a qualifying tenant never silently stalls the whole plan.
 */
export function checkTierSendAllowed(
  plan: string | null | undefined,
  args: { monthlyUsed: number; hourlyRecent: number }
): LimitDecision {
  const tier = planToTier(plan);
  const limits = TIER_LIMITS[tier];

  if (limits.monthlyMessages !== Infinity && args.monthlyUsed >= limits.monthlyMessages) {
    return {
      allowed: false,
      reason: 'monthly_quota_exceeded',
      allowance: limits.monthlyMessages,
      used: args.monthlyUsed,
    };
  }

  if (args.hourlyRecent >= limits.hourlyRate) {
    return {
      allowed: false,
      reason: 'hourly_rate_exceeded',
      limit: limits.hourlyRate,
      recent: args.hourlyRecent,
    };
  }

  return { allowed: true };
}

/** Human-readable banner text for a blocked send, shown in the dashboard. */
export function tierLimitBlockedMessage(decision: Extract<LimitDecision, { allowed: false }>): string {
  if (decision.reason === 'monthly_quota_exceeded') {
    return `Your monthly message allowance (${decision.allowance.toLocaleString()}) is used up. Renew to resume automated sending.`;
  }
  return `You've hit your ${decision.limit.toLocaleString()} messages/hour limit. Please wait before sending more.`;
}
