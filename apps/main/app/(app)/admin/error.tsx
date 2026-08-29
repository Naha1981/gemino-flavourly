'use client';

import { useEffect } from 'react';
import { ErrorPanel } from '@/components/error-panel';

/**
 * RC5 — Super Admin error boundary.
 *
 * The admin console reads cross-tenant data (prospects, platform analytics)
 * and is the page an operator opens *during* an incident, so it is the last
 * place that should show a bare 500.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[admin-error] render error', error?.digest, error?.message);
  }, [error]);

  return (
    <ErrorPanel
      title="This admin view couldn't load"
      body="The Super Admin console hit an error loading this view. Check /api/health for live dependency status, then try again."
      onReset={reset}
      homeHref="/admin"
      homeLabel="Back to admin home"
    />
  );
}
