'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import {
  SignedIn as ClerkSignedIn,
  SignedOut as ClerkSignedOut,
  SignInButton as ClerkSignInButton,
  SignUpButton as ClerkSignUpButton,
  UserButton as ClerkUserButton,
} from '@clerk/nextjs';
import { clerkIsConfigured } from '@/lib/auth/route-guard-core';

/**
 * RC1 — Clerk components with a degraded fallback.
 *
 * Three separate layers throw when the publishable key is missing, and each
 * one took down a different slice of the site:
 *
 *   1. `clerkMiddleware`      -> 500 on every matched route (fixed in
 *                               middleware.ts by not entering clerkMiddleware)
 *   2. `<ClerkProvider>`      -> "@clerk/clerk-react: Missing publishableKey",
 *                               500 on every page including /pricing, /privacy
 *                               and /terms, which need no auth at all
 *   3. `<SignedIn>` / `<SignInButton>` / `<UserButton>` -> throw on the client
 *                               when no provider is mounted, blanking the page
 *                               after hydration
 *
 * Layer 3 is handled here. When Clerk is unconfigured, these stand in with
 * plain markup: nobody is signed in, and the buttons become ordinary links.
 * The visitor still gets the full marketing page instead of a blank screen.
 *
 * The check reads a NEXT_PUBLIC_ var directly (statically inlined into the
 * client bundle at build time) so server and client agree.
 */
export const CLERK_READY: boolean = clerkIsConfigured({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
});

/**
 * PERF-1 (fixed) — marketing-page signed-in awareness with NO ClerkProvider
 * of any kind, real or lazy.
 *
 * First attempt at this used a `next/dynamic(..., { ssr: false })`
 * ClerkProvider wrapped around each marketing page's entire body. That
 * bailed the WHOLE page out of server/static rendering — confirmed via
 * `data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"` showing up in the actual
 * generated HTML for /, /pricing, /privacy and /terms, all of which shipped
 * an empty <body> to real visitors and search engines. `ssr:false` doesn't
 * just skip the dynamically-imported component itself; it suspends the
 * whole subtree passed as its children during the server pass, and Next
 * resolves that suspense by bailing to client-only rendering rather than
 * waiting.
 *
 * This version never mounts any ClerkProvider (real or lazy) on marketing
 * pages, so there's nothing that can suspend server rendering. Instead
 * `useAuthStatus` below does one plain client-side fetch to
 * `/api/auth/status` (a normal dynamic API route — those don't affect a
 * PAGE's static/dynamic classification) after mount, same pattern as any
 * other client-only widget. `app/(app)/layout.tsx` still mounts the real,
 * full `<ClerkProvider>` for dashboard/admin/sign-in/sign-up/onboarding/
 * claim, where session-aware server rendering is actually needed.
 */
type AuthStatus = { isLoaded: boolean; isSignedIn: boolean };

function useAuthStatus(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>({ isLoaded: false, isSignedIn: false });

  useEffect(() => {
    if (!CLERK_READY) return;
    let cancelled = false;
    fetch('/api/auth/status', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { signedIn: false }))
      .then((data: { signedIn?: boolean }) => {
        if (!cancelled) setStatus({ isLoaded: true, isSignedIn: Boolean(data?.signedIn) });
      })
      .catch(() => {
        if (!cancelled) setStatus({ isLoaded: true, isSignedIn: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

export function SignedIn({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuthStatus();
  if (!CLERK_READY || !isLoaded || !isSignedIn) return null;
  return <>{children}</>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuthStatus();
  // Default to "signed out" markup before the status fetch resolves (and
  // whenever Clerk is unconfigured) — matches the old degraded behaviour
  // and avoids a flash of the wrong nav state for the common case.
  if (!CLERK_READY || !isLoaded || !isSignedIn) return <>{children}</>;
  return null;
}

export function SignInButton({
  children,
  forceRedirectUrl,
}: {
  children: ReactNode;
  forceRedirectUrl?: string;
}) {
  const href = forceRedirectUrl ? `/sign-in?redirect_url=${encodeURIComponent(forceRedirectUrl)}` : '/sign-in';
  return <Link href={href}>{children}</Link>;
}

export function SignUpButton({
  children,
  forceRedirectUrl,
}: {
  children: ReactNode;
  forceRedirectUrl?: string;
}) {
  const href = forceRedirectUrl ? `/sign-up?redirect_url=${encodeURIComponent(forceRedirectUrl)}` : '/sign-up';
  return <Link href={href}>{children}</Link>;
}

/**
 * Marketing-page UserButton: a plain link to the dashboard. The real
 * avatar/menu Clerk `<UserButton>` needs a mounted ClerkProvider, which
 * marketing pages deliberately don't have (see module doc above). Signed-in
 * visitors on a marketing page are about to be redirected to /dashboard
 * anyway (see landing-client.tsx's <SignedIn><DashboardRedirect /></SignedIn>),
 * where the real <ClerkUserButton /> renders normally under app/(app)/layout.tsx's
 * ClerkProvider.
 */
export function UserButton({ afterSignOutUrl }: { afterSignOutUrl?: string }) {
  if (!CLERK_READY) return null;
  return (
    <Link
      href={afterSignOutUrl || '/dashboard'}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
      aria-label="Open dashboard"
    >
      →
    </Link>
  );
}

// Re-exported so app/(app)/ pages that need the real, fully-featured Clerk
// components (with a mounted ClerkProvider ancestor) don't have to import
// from '@clerk/nextjs' directly.
export {
  ClerkSignedIn as ClerkNativeSignedIn,
  ClerkSignedOut as ClerkNativeSignedOut,
  ClerkSignInButton as ClerkNativeSignInButton,
  ClerkSignUpButton as ClerkNativeSignUpButton,
  ClerkUserButton as ClerkNativeUserButton,
};
