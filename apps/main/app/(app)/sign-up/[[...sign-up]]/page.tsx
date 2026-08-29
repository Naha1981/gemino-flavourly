import { redirect } from 'next/navigation';
import { SignUp } from '@clerk/nextjs';
import { getSafeRedirectUrl } from '@/lib/auth/safe-redirect-url';
import { clerkIsConfigured } from '@/lib/auth/route-guard-core';
import { safeAuth } from '@/lib/auth/safe-auth';
import { AuthUnavailable } from '@/components/auth-unavailable';
import { ClaimSignUpGate } from './claim-sign-up';
import { storeClaimToken } from '../actions';

type SignUpPageProps = {
  searchParams: {
    redirect_url?: string;
    claim?: string;
  };
};

/**
 * Sign-up page.
 *
 * When the user arrived via a magic link (/claim/[token] -> /sign-up?claim=
 * <token>), we stash the token in a cookie (see ClaimSignUpGate) so the
 * claim is redeemed after Clerk completes sign-up, then redirect to
 * /onboarding. Without a claim param, it behaves exactly as before.
 */
export default async function Page({ searchParams }: SignUpPageProps) {
  const claim = typeof searchParams.claim === 'string' ? searchParams.claim : null;
  const fallback = getSafeRedirectUrl(searchParams.redirect_url, '/dashboard');

  // RC1: `<SignUp />` throws "Missing publishableKey" during render when
  // Clerk is unconfigured, which 500'd this page. Degrade to a static panel.
  if (!clerkIsConfigured(process.env)) {
    return <AuthUnavailable mode="sign-up" />;
  }

  // Signed-in guard, mirroring /sign-in (see lib/auth/sign-in-guard.wiring.test.ts).
  // A signed-in visitor never needs to see the sign-up form again.
  //
  // The claim-link case needs its own target, not a blind /dashboard bounce:
  // GET /claim/redeem is the exact route a *fresh* signup completes to
  // (app/(app)/claim/redeem/route.ts) — it only needs a userId and the
  // flavourly_claim cookie, neither of which cares whether the session is
  // brand new or pre-existing. Firing the same storeClaimToken() the
  // ClaimSignUpGate effect would have fired, then sending an already
  // signed-in visitor to that same route, reuses the one tested redemption
  // path instead of inventing a second one.
  const { userId } = await safeAuth();
  if (userId) {
    if (claim) {
      await storeClaimToken(claim);
      redirect('/claim/redeem');
    }
    redirect(fallback);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <ClaimSignUpGate claim={claim}>
        <SignUp
          fallbackRedirectUrl={fallback}
          forceRedirectUrl={claim ? '/claim/redeem' : fallback}
          afterSignUpUrl={claim ? '/claim/redeem' : fallback}
          appearance={{
            elements: {
              rootBox: 'mx-auto',
              card: 'bg-zinc-900 border border-zinc-800 text-zinc-50 shadow-xl',
              headerTitle: 'text-zinc-50',
              headerSubtitle: 'text-zinc-400',
              socialButtonsBlockButton: 'bg-zinc-800 border-zinc-700 text-zinc-50 hover:bg-zinc-700',
              formFieldLabel: 'text-zinc-400',
              formFieldInput: 'bg-zinc-950 border-zinc-700 text-zinc-50 focus:border-emerald-500',
              formButtonPrimary: 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold',
              footerActionLink: 'text-emerald-400 hover:text-emerald-300',
            },
          }}
        />
      </ClaimSignUpGate>
    </div>
  );
}
