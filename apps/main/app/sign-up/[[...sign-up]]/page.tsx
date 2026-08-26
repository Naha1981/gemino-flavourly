import { SignUp } from '@clerk/nextjs';
import { getSafeRedirectUrl } from '@/lib/auth/safe-redirect-url';
import { ClaimSignUpGate } from './claim-sign-up';

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
export default function Page({ searchParams }: SignUpPageProps) {
  const claim = typeof searchParams.claim === 'string' ? searchParams.claim : null;
  const fallback = getSafeRedirectUrl(searchParams.redirect_url, '/dashboard');

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
