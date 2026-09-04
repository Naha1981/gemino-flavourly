import { redirect } from 'next/navigation';
import { SignIn } from '@clerk/nextjs';
import { getSafeRedirectUrl } from '@/lib/auth/safe-redirect-url';
import { clerkIsConfigured } from '@/lib/auth/route-guard-core';
import { safeAuth } from '@/lib/auth/safe-auth';
import { AuthUnavailable } from '@/components/auth-unavailable';

type SignInPageProps = {
  searchParams: {
    redirect_url?: string;
  };
};

export default async function Page({ searchParams }: SignInPageProps) {
  // RC1: `<SignIn />` throws "Missing publishableKey" during render when
  // Clerk is unconfigured, which 500'd this page. Degrade to a static panel.
  if (!clerkIsConfigured(process.env)) {
    return <AuthUnavailable mode="sign-in" />;
  }

  // A signed-in visitor landing on /sign-in (bookmark, back button, stale
  // tab) gets Clerk's own "already signed in" handling, which is not always
  // a clean UX and can present as a loop depending on Clerk's client state.
  // Mirror the same server-side guard already used on `/`: send them
  // straight to their destination instead of re-rendering the sign-in form.
  const { userId } = await safeAuth();
  if (userId) {
    redirect(getSafeRedirectUrl(searchParams.redirect_url, '/dashboard'));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg p-4">
      <SignIn 
        fallbackRedirectUrl={getSafeRedirectUrl(searchParams.redirect_url, "/dashboard")}
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "bg-app-surface-0 border border-app-border text-app-fg shadow-xl",
            headerTitle: "text-app-fg",
            headerSubtitle: "text-app-muted",
            socialButtonsBlockButton: "bg-app-surface-1 border-app-border-strong text-app-fg hover:bg-app-surface-2",
            formFieldLabel: "text-app-muted",
            formFieldInput: "bg-app-bg border-app-border-strong text-app-fg focus:border-emerald-500",
            formButtonPrimary: "bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold",
            footerActionLink: "text-emerald-400 hover:text-emerald-300"
          }
        }}
      />
    </div>
  );
}
