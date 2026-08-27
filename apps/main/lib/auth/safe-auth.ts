import { auth } from '@clerk/nextjs/server';
import { clerkIsConfigured } from './route-guard-core';
import { isControlFlowError } from './safe-auth-core';

export interface SafeAuthResult {
  /** The signed-in Clerk user id, or null when nobody is signed in. */
  userId: string | null;
  /**
   * True when we could not ask Clerk at all (unconfigured or it threw).
   * Pages that show auth-dependent chrome should treat this as "signed out"
   * and keep rendering rather than surfacing an error.
   */
  degraded: boolean;
}

/**
 * `auth()` that can never take a page down.
 *
 * RC1: the landing page called `await auth()` directly. With no publishable
 * key configured, Clerk throws "Missing publishableKey", so `/` returned 500
 * — the marketing site died alongside the app. A visitor with no session
 * needs no auth at all, so the correct degraded behaviour is to treat them
 * as signed out and render the page.
 *
 * Deliberately narrow: this is for PUBLIC pages that only branch on
 * "is someone signed in?". Protected pages must keep using `auth()` /
 * `auth().protect()` so a broken Clerk cannot silently grant access.
 */
export async function safeAuth(): Promise<SafeAuthResult> {
  if (!clerkIsConfigured(process.env)) {
    return { userId: null, degraded: true };
  }
  try {
    const { userId } = await auth();
    return { userId: userId ?? null, degraded: false };
  } catch (err) {
    // Next signals "this route must be dynamic" (and redirect()/notFound())
    // by THROWING. `auth()` reads headers, so it trips DYNAMIC_SERVER_USAGE
    // during static prerender. Swallowing that logs a false error on every
    // build and, worse, lets a route be prerendered with signed-out content
    // baked in — silently breaking the signed-in redirect to /dashboard.
    // Control flow must propagate untouched.
    if (isControlFlowError(err)) throw err;

    console.error(
      '[safe-auth] auth() failed, treating visitor as signed out:',
      (err as Error)?.message,
    );
    return { userId: null, degraded: true };
  }
}
