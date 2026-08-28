'use client';

import Link from 'next/link';

/**
 * RC5 / F5 — the one place error UI lives.
 *
 * Pure static markup: no database, no Clerk, no network. An error page that
 * itself needs a dependency would fail during the very outage it exists to
 * survive — which is precisely how this app ended up showing a bare
 * "500: Internal Server Error" with no way forward.
 */
export function ErrorPanel({
  title,
  body,
  onReset,
  homeHref = '/',
  homeLabel = 'Back to home',
}: {
  title: string;
  body: string;
  onReset?: () => void;
  homeHref?: string;
  homeLabel?: string;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-lg font-bold text-amber-600 dark:text-amber-400">
          !
        </div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{body}</p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Try again
            </button>
          )}
          <Link
            href={homeHref}
            className="rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-white"
          >
            {homeLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
