import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';
import { clerkIsConfigured, guardRequest, isPublicPath } from '@/lib/auth/route-guard-core';

/**
 * RC1 fix — the middleware must never turn a Clerk misconfiguration into a
 * site-wide 500.
 *
 * What actually happens (read from @clerk/nextjs's own clerkMiddleware.js):
 *
 *   const nextMiddleware = async (request, event) => {
 *     const publishableKey = assertKey(
 *       resolvedParams.publishableKey || PUBLISHABLE_KEY,
 *       () => errorThrower.throwMissingPublishableKeyError(),   // <-- THROWS HERE
 *     );
 *     const secretKey = assertKey(
 *       resolvedParams.secretKey || SECRET_KEY,
 *       () => errorThrower.throwMissingSecretKeyError(),
 *     );
 *     ...
 *     const userHandlerResult = await handler?.(() => authObj, request, event);
 *   };
 *
 * Both key assertions run BEFORE the user handler is awaited, and they run
 * the instant `clerkMiddleware(...)`'s returned function is *invoked* — not
 * when it's defined. So when Clerk is unconfigured, this file must never
 * call that function at all, for any route. `guardRequest` still owns that
 * decision (see route-guard-core.ts) — it's unchanged and still correct.
 */

/**
 * FIX (auth-flash) — public routes now go THROUGH clerkMiddleware too, not
 * around it, whenever Clerk is actually configured.
 *
 * The previous design decided "public vs protected" BEFORE ever touching
 * Clerk, and for public routes (including /sign-in and /sign-up) returned
 * `NextResponse.next()` directly — clerkMiddleware was never invoked for
 * them at all, even when Clerk was fully and correctly configured.
 *
 * That's a real bug, not just a missed optimisation: Clerk's Next.js SDK
 * requires clerkMiddleware to actually process a request before `auth()` /
 * `safeAuth()` can correctly resolve the session in a Server Component on
 * that same request. Skip clerkMiddleware entirely on a route, and `auth()`
 * called anywhere on that route reports signed-out regardless of whether a
 * valid session cookie is present.
 *
 * That produced exactly the reported symptom: a signed-in visitor hitting
 * /sign-in got a server that always rendered the sign-in form (safeAuth()
 * on that route could never see the session) while the CLIENT-SIDE
 * <ClerkProvider>/<SignIn> — which reads the session cookie directly in the
 * browser and doesn't depend on middleware for that — correctly detected an
 * active session and tried to navigate away. Server says signed-out, client
 * says signed-in, on the same route, forever: that mismatch is the flash.
 *
 * The fix: once Clerk is confirmed configured, this single clerkMiddleware
 * instance handles EVERY route the app serves, public or protected — the
 * only thing that differs is whether it calls `.protect()`. When Clerk is
 * NOT configured, this function is still never invoked at all (see the
 * outer `middleware` function below) — a missing/invalid key still can't
 * 500 anything, public or protected, exactly as before.
 */
const clerkAwareMiddleware = clerkMiddleware((auth, request) => {
  if (isPublicPath(request.nextUrl.pathname)) {
    // Let clerkMiddleware finish processing the request (session
    // handshake/refresh, populating the context `auth()` reads downstream)
    // without forcing authentication.
    const response = NextResponse.next();
    response.headers.set('x-route-guard', 'public');
    return response;
  }

  auth().protect();

  // S4 — forward the explicit ?tenant= selection to server components as a
  // request header: App Router layouts never receive searchParams, and the
  // dashboard layout resolves its tenant through lib/tenant-resolver, which
  // reads this header as priority #1.
  const response = NextResponse.next();
  const tenantParam = request.nextUrl.searchParams.get('tenant');
  if (tenantParam) {
    response.headers.set('x-tenant-param', tenantParam);
  }
  response.headers.set('x-route-guard', 'protected');
  return response;
});

function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  return NextResponse.redirect(url);
}

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  const clerkReady = clerkIsConfigured(process.env);

  // Decision #1 — pure, and deliberately ahead of any Clerk call. Only used
  // for the Clerk-unconfigured branch now: it still correctly says which
  // routes are public (render anyway) vs protected (redirect, since nobody
  // can be authenticated) without ever touching Clerk.
  if (!clerkReady) {
    const decision = guardRequest({ rawPath: request.nextUrl.pathname, clerkConfigured: false });

    if (decision.action === 'pass') {
      return NextResponse.next();
    }

    // action === 'redirect' — the only other outcome guardRequest can
    // return with clerkConfigured: false (it never returns 'protect' in
    // that case, but TypeScript can't infer that from the call site, so
    // narrow explicitly rather than asserting).
    if (decision.action === 'redirect') {
      console.error(
        '[middleware] Clerk is not configured (missing/invalid publishable key) — ' +
          `redirecting protected route ${request.nextUrl.pathname} to ${decision.to}`,
      );
      return redirectTo(request, decision.to);
    }

    // Unreachable with clerkConfigured: false, but keeps this exhaustive
    // and fails closed (redirect, never a 500) if that ever changes.
    return redirectTo(request, '/sign-in');
  }

  // Decision #2 — Clerk is configured, so every route (public or protected)
  // goes through clerkAwareMiddleware, which decides internally whether to
  // call `.protect()`.
  //
  // Must `await`: clerkMiddleware's key assertions run inside an async
  // function, so they REJECT rather than throw synchronously. A plain
  // try/catch around an un-awaited call would let the rejection escape and
  // Next would still answer 500.
  try {
    return await clerkAwareMiddleware(request, event);
  } catch (err) {
    // Clerk can still fail here (revoked key, malformed value, its API
    // unreachable). Degrade to a redirect rather than a 500.
    console.error('[middleware] Clerk middleware failed, redirecting to /sign-in:', (err as Error)?.message);
    return redirectTo(request, '/sign-in');
  }
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|json|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
