import { ClerkProvider } from '@clerk/nextjs';
import { clerkIsConfigured } from '@/lib/auth/route-guard-core';

/**
 * PERF-1 — `<ClerkProvider>` scoped to the (app) route group only:
 * dashboard, admin, sign-in, sign-up, onboarding, claim. These are the only
 * routes that actually read auth state, so they're the only ones that need
 * to pay for it (and the only ones that need to stay server-rendered).
 *
 * Degraded-Clerk behaviour is unchanged from the old root layout: if the
 * publishable key is missing/invalid we skip the provider so this half of
 * the app fails closed to `<AuthUnavailable>` / redirects instead of a
 * hard 500. See components/clerk-shell.tsx for the client-side fallback
 * this pairs with.
 */
export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const clerkReady = clerkIsConfigured(process.env);
  if (!clerkReady) {
    console.error(
      '[app-layout] Clerk publishable key missing/invalid — rendering without ClerkProvider. ' +
        'Auth-gated routes will degrade to AuthUnavailable / redirects. ' +
        'Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY in Vercel -> Settings -> Environment Variables.',
    );
    return <>{children}</>;
  }

  return <ClerkProvider>{children}</ClerkProvider>;
}
