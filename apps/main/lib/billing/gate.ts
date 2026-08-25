/**
 * Billing gate — the single decision point for "may this tenant send AI /
 * automated messages?"
 *
 * Sending is allowed ONLY when:
 *   - plan_status IN ('trialing', 'active')  AND
 *   - (trial_ends_at > now  OR  a subscription token is present)
 *
 * Super admin tenants are NEVER gated (they operate the platform). Past-due /
 * canceled tenants become read-only: dashboard readable, banner shown.
 *
 * This module is deliberately free of any `@/lib/db` or framework import so the
 * decision logic is unit-testable directly (see gate.test.ts). The DB-read
 * wrapper lives in gate-evaluate.ts; enforcement points call
 * evaluateBillingGate() from there.
 */

export type PlanStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export const SENDABLE_STATUSES: PlanStatus[] = ['trialing', 'active'];

export interface BillingGateResult {
  /** True when the tenant may send automated/AI messages. */
  allowed: boolean;
  /** True when the tenant is in a read-only (past due / canceled) state. */
  readOnly: boolean;
  /** Reason code for logging/tests. */
  reason:
    | 'trial_active'
    | 'subscription_active'
    | 'lapsed'
    | 'past_due'
    | 'canceled'
    | 'trial_expired'
    | 'no_token';
  planStatus: PlanStatus | null;
  trialEndsAt: Date | null;
  hasSubscription: boolean;
  /** Days left in trial (negative when expired). */
  trialDaysLeft: number | null;
}

/** Minimal tenant shape the pure decision needs. */
export interface BillingTenantLike {
  planStatus?: string | null;
  trialEndsAt?: Date | null;
  payfastSubscriptionToken?: string | null;
}

/**
 * Pure billing-gate decision. Given a tenant-like object and the current time,
 * returns whether automated sending is allowed. No I/O, no framework imports.
 *
 * Unknown / unrecognised status fails closed (denied) — we never message on
 * doubt.
 */
export function decideBillingGate(
  tenant: BillingTenantLike | null | undefined,
  now: Date = new Date()
): BillingGateResult {
  if (!tenant) {
    return {
      allowed: false,
      readOnly: false,
      reason: 'no_token',
      planStatus: null,
      trialEndsAt: null,
      hasSubscription: false,
      trialDaysLeft: null,
    };
  }

  const status = (tenant.planStatus ?? 'trialing') as PlanStatus;
  const trialEndsAt = tenant.trialEndsAt ?? null;
  const hasSubscription = !!tenant.payfastSubscriptionToken;

  const nowMs = now.getTime();
  const trialActive = trialEndsAt ? trialEndsAt.getTime() > nowMs : false;
  const trialDaysLeft = trialEndsAt
    ? Math.ceil((trialEndsAt.getTime() - nowMs) / (1000 * 60 * 60 * 24))
    : null;

  // Subscription present and active → always allowed regardless of trial.
  if (status === 'active' && hasSubscription) {
    return {
      allowed: true,
      readOnly: false,
      reason: 'subscription_active',
      planStatus: status,
      trialEndsAt,
      hasSubscription,
      trialDaysLeft,
    };
  }

  // Active status but no subscription token (lapsed payment / data
  // inconsistency) and the trial has expired → read-only. A tenant that was
  // paying but lapsed keeps dashboard access but loses AI sending.
  if (status === 'active' && !hasSubscription && !trialActive) {
    return {
      allowed: false,
      readOnly: true,
      reason: 'lapsed',
      planStatus: status,
      trialEndsAt,
      hasSubscription,
      trialDaysLeft,
    };
  }

  // Trialing and trial not expired → allowed.
  if (status === 'trialing' && trialActive) {
    return {
      allowed: true,
      readOnly: false,
      reason: 'trial_active',
      planStatus: status,
      trialEndsAt,
      hasSubscription,
      trialDaysLeft,
    };
  }

  // Past due → read-only.
  if (status === 'past_due') {
    return {
      allowed: false,
      readOnly: true,
      reason: 'past_due',
      planStatus: status,
      trialEndsAt,
      hasSubscription,
      trialDaysLeft,
    };
  }

  // Canceled → read-only.
  if (status === 'canceled') {
    return {
      allowed: false,
      readOnly: true,
      reason: 'canceled',
      planStatus: status,
      trialEndsAt,
      hasSubscription,
      trialDaysLeft,
    };
  }

  // Trial expired (status trialing but past end) → read-only.
  if (status === 'trialing' && !trialActive) {
    return {
      allowed: false,
      readOnly: true,
      reason: 'trial_expired',
      planStatus: status,
      trialEndsAt,
      hasSubscription,
      trialDaysLeft,
    };
  }

  return {
    allowed: false,
    readOnly: false,
    reason: 'no_token',
    planStatus: status,
    trialEndsAt,
    hasSubscription,
    trialDaysLeft,
  };
}
