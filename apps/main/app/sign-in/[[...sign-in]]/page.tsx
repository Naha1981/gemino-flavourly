import Link from 'next/link';
import { isClerkConfigured, isDemoMode } from '@/lib/config';

export default function Page() {
  if (isDemoMode() || !isClerkConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink p-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-ink-2 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-saffron font-display text-2xl text-ink">
            F
          </div>
          <h1 className="font-display text-3xl text-cream">The Marula Room</h1>
          <p className="mt-2 text-sm text-cream-dim">
            Preview house. Clerk is not configured in this environment, so you walk straight onto the floor.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-saffron px-4 py-3 text-sm font-semibold text-ink"
          >
            Open the house desk
          </Link>
        </div>
      </div>
    );
  }

  const { SignIn } = require('@clerk/nextjs') as typeof import('@clerk/nextjs');
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <SignIn forceRedirectUrl="/dashboard" />
    </div>
  );
}
