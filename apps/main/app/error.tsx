'use client';

import { useEffect } from 'react';
import { ErrorPanel } from '@/components/error-panel';

/**
 * RC5 — root-level error boundary.
 *
 * This app shipped with NO error.tsx anywhere, so an unhandled throw in any
 * server component rendered Next's bare "500: Internal Server Error" page
 * with no way forward. During the outage that meant every route looked
 * identically broken with nothing to click.
 *
 * Catches errors from the page and its nested segments. Errors thrown by the
 * root layout itself are caught by ./global-error.tsx instead.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest server-side logging already prints, so a report
    // from a user can be matched to a log line.
    console.error('[error-boundary] unhandled render error', error?.digest, error?.message);
  }, [error]);

  return (
    <ErrorPanel
      title="Something went wrong on this page"
      body="The page hit an unexpected error. Your data is unaffected — try again, and if it keeps happening let us know and we'll look into it."
      onReset={reset}
    />
  );
}
