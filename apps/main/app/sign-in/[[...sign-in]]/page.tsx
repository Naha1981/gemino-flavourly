import { SignIn } from '@clerk/nextjs';
import { getSafeRedirectUrl } from '@/lib/auth/safe-redirect-url';
import { clerkIsConfigured } from '@/lib/auth/route-guard-core';
import { AuthUnavailable } from '@/components/auth-unavailable';

type SignInPageProps = {
  searchParams: {
    redirect_url?: string;
  };
};

export default function Page({ searchParams }: SignInPageProps) {
  // RC1: `<SignIn />` throws "Missing publishableKey" during render when
  // Clerk is unconfigured, which 500'd this page. Degrade to a static panel.
  if (!clerkIsConfigured(process.env)) {
    return <AuthUnavailable mode="sign-in" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <SignIn 
        fallbackRedirectUrl={getSafeRedirectUrl(searchParams.redirect_url, "/dashboard")}
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "bg-zinc-900 border border-zinc-800 text-zinc-50 shadow-xl",
            headerTitle: "text-zinc-50",
            headerSubtitle: "text-zinc-400",
            socialButtonsBlockButton: "bg-zinc-800 border-zinc-700 text-zinc-50 hover:bg-zinc-700",
            formFieldLabel: "text-zinc-400",
            formFieldInput: "bg-zinc-950 border-zinc-700 text-zinc-50 focus:border-emerald-500",
            formButtonPrimary: "bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold",
            footerActionLink: "text-emerald-400 hover:text-emerald-300"
          }
        }}
      />
    </div>
  );
}
