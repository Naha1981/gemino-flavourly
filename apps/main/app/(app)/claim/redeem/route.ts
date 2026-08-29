import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { redeemClaimToken } from '@/lib/brand-intelligence/claim';
import { CLAIM_COOKIE } from '@/lib/brand-intelligence/magic-link';
import { ACTIVE_TENANT_COOKIE } from '@/lib/tenant-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-side claim redemption — the sign-up success redirect target.
 *
 * After Clerk completes sign-up (started from /sign-up?claim=<token>) the
 * browser lands on GET /claim/redeem. This route handler reads the
 * `flavourly_claim` cookie, redeems the token (linking the tenant to the
 * user, flipping demo -> live trialing, stamping Clerk metadata, marking the
 * token used), then 302-redirects into the CLAIMED tenant's dashboard
 * (/dashboard?tenant=<id>, S2) with the flavourly_active_tenant cookie set.
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

  // S2 — deep-link into the CLAIMED tenant's dashboard; on failure fall back
  // to the plain dashboard.
  const target = result.redirect ?? (result.ok ? '/dashboard' : '/dashboard');
  const response = NextResponse.redirect(new URL(target, req.url));

  // S2 — pin the browser to the claimed tenant so the resolver's cookie
  // source agrees with the ?tenant= deep-link from the very first load.
  if (result.ok && result.tenantId) {
    response.cookies.set(ACTIVE_TENANT_COOKIE, result.tenantId, {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return response;
}
