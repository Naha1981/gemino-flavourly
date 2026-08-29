/**
 * PERF-1 — deliberately empty. No ClerkProvider (real or lazy), no dynamic
 * APIs. That's what lets /, /pricing, /privacy and /terms prerender as
 * genuine static HTML with real content in the body — see app/layout.tsx
 * and components/clerk-shell.tsx for the full explanation, including the
 * ssr:false ClerkProvider approach this replaced after it was found to
 * bail the entire page body out to client-side rendering.
 */
export default function MarketingGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
