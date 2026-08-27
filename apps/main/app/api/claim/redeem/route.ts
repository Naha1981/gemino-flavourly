import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { redeemClaimToken } from '@/lib/brand-intelligence/claim';
import { CLAIM_COOKIE } from '@/lib/brand-intelligence/magic-link';
import { ACTIVE_TENANT_COOKIE } from '@/lib/tenant-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/claim/redeem — claim a demo tenant for the current user.
 *
 * Reads the claim token from the `flavourly_claim` cookie (set by the
 * sign-up page when the user arrived via ?claim=<token>), redeems it, clears
 * the cookie and returns where to send the user. Requires a signed-in user.
 *
 * Idempotent: re-claiming with the same user is a success; a different user
 * is rejected. This route shares the single decision path (redeemClaimToken /
 * assessClaimAttempt) with the public /claim page, so the UI and the sign-up
 * flow can never disagree about whether a token is claimable.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let token = cookies().get(CLAIM_COOKIE)?.value ?? null;
  if (!token) {
    // Allow an explicit body fallback for callers without the cookie.
    try {
      const body = await req.json();
      if (typeof body.claim === 'string') token = body.claim;
    } catch {
      // no JSON body — rely on the cookie only
    }
  }

  if (!token) {
    return NextResponse.json({ error: 'No claim token found' }, { status: 400 });
  }

  const result = await redeemClaimToken(token, userId);

  // Always clear the cookie, whether or not the claim succeeded.
  const response = NextResponse.json({
    ok: result.ok,
    outcome: result.outcome,
    tenantId: result.tenantId ?? null,
    redirect: result.redirect,
    error: result.error,
  });

  if (result.ok) {
    cookies().set(CLAIM_COOKIE, '', { maxAge: 0, path: '/' });
    // S2 — pin the browser to the CLAIMED tenant so the very next dashboard
    // load resolves to it even before the ?tenant= deep-link is followed.
    if (result.tenantId) {
      cookies().set(ACTIVE_TENANT_COOKIE, result.tenantId, {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 30,
      });
    }
  }
  return response;
}
