import { NextResponse } from 'next/server';
import { safeAuth } from '@/lib/auth/safe-auth';

/**
 * PERF-1 fix — replaces the ssr:false ClerkAwareRegion approach, which
 * caused React to bail the ENTIRE page body to client-side rendering on
 * every route it wrapped (confirmed via `data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"`
 * in the generated static HTML for /, /pricing, /privacy and /terms — all
 * four shipped empty <body> content to real visitors and search engines).
 *
 * Marketing pages now stay plain static server components with zero Clerk
 * anywhere in their render tree. Signed-in-aware chrome (nav "Open
 * Dashboard" button, the / -> /dashboard redirect) instead does one small
 * client-side fetch to this endpoint after mount — a normal islands-of-
 * interactivity pattern, not a Suspense/dynamic-import boundary, so it
 * can never suppress server-rendered content around it.
 *
 * Public by design (see lib/auth/route-guard-core.ts PUBLIC_PREFIXES):
 * an unauthenticated visitor calling this must get `{ signedIn: false }`
 * back, not a redirect — the marketing pages that call it are public too.
 */
export async function GET() {
  const { userId } = await safeAuth();
  return NextResponse.json(
    { signedIn: Boolean(userId) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
