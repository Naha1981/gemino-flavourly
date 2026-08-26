'use server';

import { cookies } from 'next/headers';
import { CLAIM_COOKIE } from '@/lib/brand-intelligence/magic-link';

/**
 * Stash the claim token from ?claim=<token> into a SameSite=Lax, 1-hour
 * cookie so the POST /api/claim/redeem call (after Clerk completes sign-up)
 * can find it. HttpOnly keeps it out of client JS; SameSite=Lax means it is
 * still sent on the top-level POST the client makes immediately after the
 * sign-up redirect.
 */
export async function storeClaimToken(token: string) {
  const safe = token.trim();
  if (!safe || safe.length > 200) return;
  cookies().set(CLAIM_COOKIE, safe, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60, // 1 hour
  });
}
