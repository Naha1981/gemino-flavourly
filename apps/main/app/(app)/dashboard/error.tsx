'use client';

import { useEffect } from 'react';
import { ErrorPanel } from '@/components/error-panel';

/**
 * RC5 / F2 — dashboard error boundary.
 *
 * Every /dashboard route renders inside the dashboard layout, which resolves
 * the active tenant from the database. A DB hiccup therefore used to take
 * down all seventeen dashboard routes at once with a bare 500. The layout now
 * degrades gracefully, and this boundary catches anything that still escapes
 * so the chrome (sidebar, tenant switcher) stays reachable.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard-error] render error', error?.digest, error?.message);
  }, [error]);

  return (
    <ErrorPanel
      title="This dashboard page couldn't load"
      body="We couldn't load this view — usually a brief database connection problem. The rest of your dashboard is still available from the sidebar."
      onReset={reset}
      homeHref="/dashboard"
      homeLabel="Back to overview"
    />
  );
}
