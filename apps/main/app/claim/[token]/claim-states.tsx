import Link from 'next/link';

/** Invalid / expired magic-link state. */
export function ClaimInvalid({ reason }: { reason?: 'expired' }) {
  return (
    <div className="max-w-md space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
      <h1 className="text-xl font-semibold text-zinc-50">
        {reason === 'expired' ? 'This link has expired' : 'This link is invalid'}
      </h1>
      <p className="text-sm text-zinc-400">
        {reason === 'expired'
          ? 'Magic links expire after 30 days. Ask the Flavourly team for a fresh one.'
          : 'The magic link you opened is not recognisable. Double-check the address or ask the Flavourly team.'}
      </p>
    </div>
  );
}

/**
 * Already-claimed state — never re-claims.
 *
 * S3 — both CTAs deep-link the OWNING user straight into the claimed
 * tenant's dashboard: Sign in carries Clerk's redirect_url to
 * /dashboard?tenant=<id>, and Go home goes there directly (a visitor who is
 * already signed in as the owner lands in their tenant; anyone else gets the
 * normal sign-in wall first — never someone else's data).
 */
export function ClaimAlreadyClaimed({ tenantName, tenantId }: { tenantName: string; tenantId?: string }) {
  const dashboardHref = tenantId ? `/dashboard?tenant=${tenantId}` : '/dashboard';
  const signInHref = tenantId
    ? `/sign-in?redirect_url=${encodeURIComponent(`/dashboard?tenant=${tenantId}`)}`
    : '/sign-in';

  return (
    <div className="max-w-md space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
      <h1 className="text-xl font-semibold text-zinc-50">{tenantName} has been claimed</h1>
      <p className="text-sm text-zinc-400">
        This app has already been claimed. Sign in to access your dashboard.
      </p>
      <a
        data-testid="already-claimed-sign-in"
        href={signInHref}
        className="inline-flex items-center justify-center rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
      >
        Sign in
      </a>
      <p className="text-xs text-zinc-500">
        Not your account?{' '}
        <Link data-testid="already-claimed-go-home" href={dashboardHref} className="text-emerald-400 hover:underline">
          Go home
        </Link>
      </p>
    </div>
  );
}
