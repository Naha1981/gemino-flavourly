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
 *
 * Explicit signInUrl/signUpUrl — Clerk's own docs: "Set the
 * CLERK_SIGN_IN_URL environment variable to tell Clerk where the <SignIn />
 * component is being hosted." .env.example documents
 * NEXT_PUBLIC_CLERK_SIGN_IN_URL / _SIGN_UP_URL as expected config for this
 * project, but whether that's actually set correctly in Vercel isn't
 * something this repo can verify — a missing/wrong value there is a known
 * cause of Clerk's internal navigation (e.g. the "Sign in instead" /
 * "Sign up instead" links each component renders, and Clerk's own
 * client-side routing between its sub-steps) resolving incorrectly and
 * bouncing through an unexpected redirect. Passing both explicitly as
 * props makes this correct regardless of Vercel's env var state.
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

  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    >
      {children}
    </ClerkProvider>
  );
}
