import { ClerkAwareRegion } from '@/components/clerk-shell';

/**
 * PERF-1 — no dynamic APIs, no server-side `<ClerkProvider>` here. That's
 * what lets /, /pricing, /privacy and /terms prerender as static (○)
 * content instead of being forced dynamic — see app/layout.tsx for the
 * full explanation.
 *
 * <ClerkAwareRegion> (see components/clerk-shell.tsx) lazily mounts a
 * client-only ClerkProvider around marketing chrome so <SignedIn> /
 * <UserButton> / the sign-in redirect still work after hydration, without
 * that provider ever running during the server/static render.
 */
export default function MarketingGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkAwareRegion>{children}</ClerkAwareRegion>;
}
