import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { redeemClaimToken } from '@/lib/brand-intelligence/claim';
import { CLAIM_COOKIE } from '@/lib/brand-intelligence/magic-link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-side claim redemption — the sign-up success redirect target.
 *
 * After Clerk completes sign-up (started from /sign-up?claim=<token>) the
 * browser lands on GET /claim/redeem. This route handler reads the
 * `flavourly_claim` cookie, redeems the token (linking the tenant to the
 * user, flipping demo -> live trialing, stamping Clerk metadata, marking the
 * token used), then 302-redirects to /onboarding.
 *
 * Doing the redeem server-side (rather than a client POST) removes the race
 * with the onboarding wizard, which reads the user's tenant on load — the
 * tenant must already be linked by then.
 *
 * A Route Handler (not a page) so cookie mutation is legal here.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', req.url));
  }

  const token = cookies().get(CLAIM_COOKIE)?.value ?? null;
  if (!token) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  const result = await redeemClaimToken(token, userId);

  // Always clear the cookie so a later visit doesn't re-attempt.
  cookies().set(CLAIM_COOKIE, '', { maxAge: 0, path: '/' });

  const target = result.redirect ?? (result.ok ? '/onboarding' : '/dashboard');
  return NextResponse.redirect(new URL(target, req.url));
}
