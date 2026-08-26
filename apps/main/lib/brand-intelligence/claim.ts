import { db } from '@/lib/db';
import { tenants, tenantClaimTokens, prospects, memberships } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { clerkClient } from '@clerk/nextjs/server';
import { findClaimToken } from './prospect-store.ts';
import { assessClaimAttempt } from './magic-link.ts';

export type ClaimOutcome =
  | 'claimed'
  | 'already_claimed_same_user'
  | 'already_claimed_other_user'
  | 'invalid'
  | 'expired';

export interface ClaimResult {
  ok: boolean;
  outcome: ClaimOutcome;
  /** The tenant this claim resolved to (present on ok outcomes). */
  tenantId?: string;
  /** Where to send the user after a successful (or idempotent) claim. */
  redirect?: string;
  error?: string;
}

/** S2 — deep-link straight into the CLAIMED tenant's dashboard. */
export function dashboardDeepLink(tenantId: string): string {
  return `/dashboard?tenant=${tenantId}`;
}

let lastRedeemAt: Date | null = null;

/**
 * Redeem a claim token for the signed-in user.
 *
 * Links the tenant to the owner (tenant.owner_id), flips the demo tenant to a
 * live trialing tenant (tenant_mode live, plan_status trialing, trial end =
 * now + 14 days), marks the token used and flips the prospect to 'claimed'.
 *
 * Idempotent: a re-claim by the SAME user is a success (redirect to
 * onboarding); a claim by a DIFFERENT user is rejected. The atomic guard
 * lives in the UPDATE's WHERE clause (claimed_at IS NULL), so two racing
 * requests can only ever produce one successful claim — the loser observes
 * the other user already claimed it.
 */
export async function redeemClaimToken(token: string, clerkUserId: string): Promise<ClaimResult> {
  const row = await findClaimToken(token);
  if (!row) return { ok: false, outcome: 'invalid', error: 'This claim link is invalid.' };

  const now = new Date();
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, outcome: 'expired', error: 'This claim link has expired.' };
  }

  const attempt = assessClaimAttempt(row, clerkUserId);
  if (attempt.outcome === 'already_claimed_same_user') {
    // Idempotent: the same owner already claimed this app — not an error.
    // Deep-link them straight into their (already claimed) tenant dashboard.
    return {
      ok: true,
      outcome: 'already_claimed_same_user',
      tenantId: row.tenantId,
      redirect: dashboardDeepLink(row.tenantId),
    };
  }
  if (attempt.outcome === 'already_claimed_other_user') {
    return { ok: false, outcome: 'already_claimed_other_user', error: 'This app has already been claimed by another account.' };
  }

  // Atomic claim: only the caller whose UPDATE actually matched an unclaimed
  // row proceeds. If zero rows come back, another request won the race.
  const [claimedRow] = await db
    .update(tenantClaimTokens)
    .set({ claimedAt: now, claimedByUserId: clerkUserId })
    .where(and(eq(tenantClaimTokens.token, token), isNull(tenantClaimTokens.claimedAt)))
    .returning();

  if (!claimedRow) {
    const latest = await findClaimToken(token);
    if (latest?.claimedByUserId === clerkUserId) {
      return {
        ok: true,
        outcome: 'already_claimed_same_user',
        tenantId: latest.tenantId,
        redirect: dashboardDeepLink(latest.tenantId),
      };
    }
    return { ok: false, outcome: 'already_claimed_other_user', error: 'This app has already been claimed.' };
  }

  // Link the tenant to the owner and flip demo -> live trialing. Sets BOTH
  // ownership columns (legacy owner_id and S2/S4 owner_user_id) so old and
  // new resolvers agree.
  await db
    .update(tenants)
    .set({
      ownerId: clerkUserId,
      ownerUserId: clerkUserId,
      tenantMode: 'live',
      planStatus: 'trialing',
      trialEndsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    })
    .where(eq(tenants.id, claimedRow.tenantId))
    .catch((err) => console.error('[claim] failed to update tenant', err));

  // S2 — grant the claimant an 'owner' membership on the tenant. This is the
  // row the tenant resolver + /api/tenant/switch read to authorise access.
  // onConflictDoNothing keeps a re-claim idempotent (unique (user, tenant)).
  await db
    .insert(memberships)
    .values({ userId: clerkUserId, tenantId: claimedRow.tenantId, role: 'owner' })
    .onConflictDoNothing()
    .catch((err) => console.error('[claim] failed to insert membership', err));

  // Flip the source prospect, if there is one.
  await db
    .update(prospects)
    .set({ status: 'claimed', claimedAt: now, updatedAt: now })
    .where(eq(prospects.tenantId, claimedRow.tenantId))
    .catch((err) => console.error('[claim] failed to update prospect', err));

  // Stamp the claimed tenant onto the Clerk user's publicMetadata so that
  // getOrCreateTenant() (onboarding + dashboard) resolves to THIS tenant
  // instead of silently creating a brand-new one for the user.
  try {
    const client = typeof clerkClient === 'function' ? await (clerkClient as any)() : clerkClient;
    await client.users.updateUserMetadata(clerkUserId, {
      publicMetadata: { tenantId: claimedRow.tenantId },
    });
  } catch (err) {
    console.error('[claim] failed to stamp tenantId onto Clerk metadata', err);
  }

  lastRedeemAt = now;

  // S2 — land the owner directly in their CLAIMED tenant's dashboard.
  return {
    ok: true,
    outcome: 'claimed',
    tenantId: claimedRow.tenantId,
    redirect: dashboardDeepLink(claimedRow.tenantId),
  };
}

/** Convenience for tests / observability: the last successful redeem time. */
export function lastRedeemTimestamp(): Date | null {
  return lastRedeemAt;
}
