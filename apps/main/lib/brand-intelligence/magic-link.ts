/**
 * Brand Intelligence Engine — magic link generation & validation.
 *
 * Produces the opaque, single-use claim token used to hand a demo tenant to
 * a prospect's owner, and centralises the expiry / already-claimed decisions
 * so the claim page, the /api/claim/redeem endpoint and the cron all agree.
 * Framework free (node:crypto only) so it is unit-testable.
 */

import { randomBytes } from 'node:crypto';

export const CLAIM_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Cookie that carries the claim token from /sign-up?claim= into redeem. */
export const CLAIM_COOKIE = 'flavourly_claim';

export interface ClaimTokenRecord {
  token: string;
  tenantId: string;
  createdAt: Date;
  expiresAt: Date;
  claimedAt: Date | null;
  claimedByUserId: string | null;
}

/**
 * Generate an opaque, URL-safe claim token. Not a UUID-prefixed-with-tenant
 * or anything that leaks PII — a random 32-byte base64url string is both
 * unguessable and unlinkable.
 */
export function generateClaimToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Expiry date for a token just created (now + 30 days). */
export function tokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + CLAIM_TOKEN_TTL_MS);
}

/**
 * Pure decision: what should happen when someone opens /claim/[token]?
 * Mirrors the DB lookup (token exists + expiry) without I/O so the logic is
 * unit-testable and the UI lives off one answer.
 */
export function assessClaimToken(
  token: ClaimTokenRecord | null | undefined,
  now: Date = new Date()
):
  | { kind: 'valid' }
  | { kind: 'invalid'; reason: 'missing' }
  | { kind: 'expired'; reason: 'expired' }
  | { kind: 'claimed'; reason: 'already_claimed' } {
  if (!token) return { kind: 'invalid', reason: 'missing' };
  if (token.claimedAt) return { kind: 'claimed', reason: 'already_claimed' };
  if (token.expiresAt.getTime() <= now.getTime()) return { kind: 'expired', reason: 'expired' };
  return { kind: 'valid' };
}

/**
 * Pure idempotency decision for a claim attempt. Called after the reconciling
 * transaction to decide whether to report success, or a no-op duplicate, to
 * the client. A previous claim by the SAME user is idempotent (success);
 * a claim by a DIFFERENT user is a conflict.
 */
export function assessClaimAttempt(token: ClaimTokenRecord | null | undefined, userId: string): {
  canClaim: boolean;
  outcome: 'fresh_claim' | 'already_claimed_same_user' | 'already_claimed_other_user';
} {
  if (!token) return { canClaim: false, outcome: 'already_claimed_other_user' };
  if (token.claimedAt) {
    return token.claimedByUserId === userId
      ? { canClaim: false, outcome: 'already_claimed_same_user' }
      : { canClaim: false, outcome: 'already_claimed_other_user' };
  }
  return { canClaim: true, outcome: 'fresh_claim' };
}

/** Build the public claim URL from the token + the configured app origin. */
export function buildClaimLink(token: string, appUrl?: string): string {
  const base = (appUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://gemino-flavourly-whatsapp.vercel.app').replace(/\/$/, '');
  return `${base}/claim/${token}`;
}
