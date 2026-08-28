'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
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
 * Layer 3 is handled here. When Clerk is unconfigured the root layout skips
 * `<ClerkProvider>`, so these stand in with plain markup: nobody is signed
 * in, and the buttons become ordinary links. The visitor still gets the full
 * marketing page instead of a blank screen.
 *
 * The check reads a NEXT_PUBLIC_ var directly (statically inlined into the
 * client bundle at build time) so server and client agree.
 */
export const CLERK_READY: boolean = clerkIsConfigured({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
});

export function SignedIn({ children }: { children: ReactNode }) {
  if (!CLERK_READY) return null;
  return <ClerkSignedIn>{children}</ClerkSignedIn>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  if (!CLERK_READY) return <>{children}</>;
  return <ClerkSignedOut>{children}</ClerkSignedOut>;
}

export function SignInButton({
  children,
  forceRedirectUrl,
}: {
  children: ReactNode;
  forceRedirectUrl?: string;
}) {
  if (!CLERK_READY) return <Link href="/sign-in">{children}</Link>;
  return <ClerkSignInButton forceRedirectUrl={forceRedirectUrl}>{children}</ClerkSignInButton>;
}

export function SignUpButton({
  children,
  forceRedirectUrl,
}: {
  children: ReactNode;
  forceRedirectUrl?: string;
}) {
  if (!CLERK_READY) return <Link href="/sign-up">{children}</Link>;
  return <ClerkSignUpButton forceRedirectUrl={forceRedirectUrl}>{children}</ClerkSignUpButton>;
}

export function UserButton({ afterSignOutUrl }: { afterSignOutUrl?: string }) {
  if (!CLERK_READY) return null;
  return <ClerkUserButton afterSignOutUrl={afterSignOutUrl} />;
}
