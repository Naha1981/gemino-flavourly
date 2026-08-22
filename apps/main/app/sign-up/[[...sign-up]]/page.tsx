import Link from 'next/link';
import { isClerkConfigured, isDemoMode } from '@/lib/config';

export default function Page() {
  if (isDemoMode() || !isClerkConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink p-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-ink-2 p-8 text-center">
          <h1 className="font-display text-3xl text-cream">Create your house</h1>
          <p className="mt-2 text-sm text-cream-dim">
            In production this is Clerk. Here, the demo tenant is already plated.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex w-full justify-center rounded-md bg-saffron px-4 py-3 text-sm font-semibold text-ink"
          >
            Continue
          </Link>
        </div>
      </div>
    );
  }

  const { SignUp } = require('@clerk/nextjs') as typeof import('@clerk/nextjs');
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <SignUp forceRedirectUrl="/dashboard" />
    </div>
  );
}
