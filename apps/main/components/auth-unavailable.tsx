import Link from 'next/link';

/**
 * RC1 — what /sign-in and /sign-up render when Clerk is not configured.
 *
 * `<SignIn />` and `<SignUp />` throw "Missing publishableKey" during
 * render, which turned both pages into 500s. A visitor landing on the
 * sign-in page during an auth outage should be told sign-in is temporarily
 * unavailable and given a way back — not shown Next's error page.
 *
 * Pure static UI: no database, no Clerk, no network.
 */
export function AuthUnavailable({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const title = mode === 'sign-in' ? 'Sign in is temporarily unavailable' : 'Sign up is temporarily unavailable';

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center shadow-xl">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10">
          <span className="text-xl" role="img" aria-label="warning">
            !
          </span>
        </div>
        <h1 className="text-lg font-semibold text-zinc-50">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Our authentication provider is not responding. Your restaurant&apos;s data is safe and
          unaffected &mdash; this only blocks signing in. Please try again in a few minutes.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/"
            className="rounded-md bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white"
          >
            Back to home
          </Link>
          <a
            href="mailto:support@flavourly.ai"
            className="rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white"
          >
            Contact support
          </a>
        </div>
      </div>
    </div>
  );
}
