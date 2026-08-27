import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';
import { clerkIsConfigured, guardRequest } from '@/lib/auth/route-guard-core';

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
 * Both key assertions run BEFORE the user handler is awaited. So guarding
 * inside `clerkMiddleware((auth, req) => ...)` cannot help: by the time our
 * callback would run, the throw has already happened. Wrapping the callback
 * body in try/catch was the wrong fix and demonstrably did not work (the
 * app still returned 500 on /, /pricing, /privacy and /terms with no key).
 *
 * The fix is therefore to decide BEFORE entering clerkMiddleware at all.
 * `guardRequest` is a pure function of the pathname, so a missing or
 * malformed key can never reach a public route.
 */

/**
 * Built once, but only ever *invoked* when Clerk is configured — invoking it
 * is what triggers the key assertions above.
 */
const clerkProtectedMiddleware = clerkMiddleware((auth, request) => {
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

  // Decision #1 — pure, and deliberately ahead of any Clerk call.
  const decision = guardRequest({ rawPath: request.nextUrl.pathname, clerkConfigured: clerkReady });

  if (decision.action === 'pass') {
    // Public route or static asset. Never touches Clerk, so it renders even
    // with every auth env var missing — this is what keeps the marketing
    // site up during an auth outage.
    return NextResponse.next();
  }

  if (decision.action === 'redirect') {
    // Protected route, but Clerk is unusable: we cannot authenticate
    // anyone, so send the visitor to the sign-in page instead of throwing.
    console.error(
      '[middleware] Clerk is not configured (missing/invalid publishable key) — ' +
        `redirecting protected route ${request.nextUrl.pathname} to ${decision.to}`,
    );
    return redirectTo(request, decision.to);
  }

  // Decision #2 — genuinely protected route with a usable Clerk config.
  //
  // Must `await`: clerkMiddleware's key assertions run inside an async
  // function, so they REJECT rather than throw synchronously. A plain
  // try/catch around an un-awaited call would let the rejection escape and
  // Next would still answer 500.
  try {
    return await clerkProtectedMiddleware(request, event);
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
