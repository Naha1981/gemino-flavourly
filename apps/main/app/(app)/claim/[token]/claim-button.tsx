'use client';

import Link from 'next/link';
import { useMemo } from 'react';

/**
 * Gold "Claim Your App" button on the public /claim/[token] page.
 *
 * Links to /sign-up?claim=<token>. The sign-up page stashes the token in a
 * SameSite=Lax cookie (flavourly_claim) so that after Clerk completes the
 * sign-up, the client can redeem it via POST /api/claim/redeem and land on
 * /onboarding. Uses a plain <a>/<Link> (no auth) — the page is public.
 */
export function ClaimButton({ token, large = false }: { token: string; large?: boolean }) {
  const href = useMemo(() => `/sign-up?claim=${encodeURIComponent(token)}`, [token]);
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 font-semibold text-zinc-950 shadow-lg shadow-amber-500/20 ring-1 ring-amber-200/50 transition-transform hover:scale-[1.02] ${
        large ? 'px-8 py-4 text-lg' : 'px-4 py-2 text-sm'
      }`}
    >
      Claim Your App
    </Link>
  );
}
