'use client';

import { ErrorPanel } from '@/components/error-panel';

/**
 * RC5 — last-resort boundary for errors thrown by the ROOT LAYOUT.
 *
 * This is the boundary that matters for the outage we just fixed: the
 * layout's `<ClerkProvider>` threw "Missing publishableKey", and `error.tsx`
 * cannot catch a layout error because the layout is what renders it. Without
 * global-error.tsx that failure produced a bare 500 on every single route.
 *
 * Next replaces the whole document when this renders, so it must supply its
 * own <html> and <body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error('[global-error] root layout render error', error?.digest, error?.message);

  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-50">
        <ErrorPanel
          title="Flavourly is having trouble starting up"
          body="The application shell failed to render. This is a configuration problem on our side, not something you did — your restaurant's data is safe. Please try again in a moment."
          onReset={reset}
        />
      </body>
    </html>
  );
}
