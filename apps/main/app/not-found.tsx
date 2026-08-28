import Link from 'next/link';

/**
 * RC5 — custom 404.
 *
 * Previously an unknown URL rendered Next's minimal default 404, which is
 * easy to mistake for the site being broken. This states plainly that the
 * page was not found and offers the two useful exits.
 *
 * Pure static UI: no database, no Clerk, no network.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-semibold tracking-widest text-zinc-400">404</p>
        <h1 className="mt-3 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          The link may be out of date, or the page may have moved. Nothing is broken &mdash; pick a
          destination below.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Back to home
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-white"
          >
            Open dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
