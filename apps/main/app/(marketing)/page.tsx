import LandingClient from './landing-client';

/**
 * PERF-1 — plain static page. No server component auth check.
 *
 * Previously this awaited `safeAuth()` and redirected signed-in visitors to
 * /dashboard before rendering anything, but `safeAuth()` calls Clerk's
 * `auth()`, which reads headers and forces the route dynamic — the opposite
 * of this gate's goal. The signed-in redirect now happens client-side, in
 * LandingClient (via <SignedIn><DashboardRedirect /></SignedIn>), so this
 * page itself has zero dynamic APIs and can prerender as static HTML.
 */
export default function Page() {
  return <LandingClient />;
}
