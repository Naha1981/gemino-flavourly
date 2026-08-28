/**
 * RC5 / F6 — the shared loading state.
 *
 * Pure static markup, so it can render before any data (or database) is
 * available. Server Component: no 'use client' needed and no hooks.
 */
export function LoadingPanel({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
        <span
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300"
          role="status"
          aria-label={label}
        />
        {label}&hellip;
      </div>
    </div>
  );
}
