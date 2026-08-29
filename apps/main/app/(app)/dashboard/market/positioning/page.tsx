import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, BarChart3, Star, Swords, Trophy } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { getPositioningReport } from '@/lib/market/positioning-store';

export const dynamic = 'force-dynamic';

const BAND_META: Record<string, { label: string; classes: string }> = {
  budget: { label: 'Budget', classes: 'border-emerald-800/70 bg-emerald-950/40 text-emerald-300' },
  'mid-range': { label: 'Mid-range', classes: 'border-sky-800/70 bg-sky-950/40 text-sky-300' },
  premium: { label: 'Premium', classes: 'border-amber-800/70 bg-amber-950/40 text-amber-300' },
  unknown: { label: 'Unknown', classes: 'border-zinc-700 bg-zinc-800 text-zinc-400' },
};

const MENU_SOURCE_COPY: Record<string, string> = {
  menu_text: 'your published menu',
  description: 'your restaurant description (not a menu)',
  system_prompt: 'your AI instructions (not a menu)',
  none: 'nothing — no menu has been recorded',
};

/**
 * Gate #18 — positioning: how this restaurant sits against the ones around it
 * on price, rating, menu coverage and uniqueness.
 *
 * Server-rendered from stored data only, so the page is cheap to open and the
 * numbers are the same ones the API returns.
 */
export default async function MarketPositioningPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const report = await getPositioningReport(tenant.id, { now: new Date() });
  const band = BAND_META[report.price.band] ?? BAND_META.unknown;
  const maxAverage = Math.max(
    1,
    ...report.price.standings.map((entry) => entry.average ?? 0)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 border-b border-zinc-800 pb-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
          <BarChart3 className="h-5 w-5 text-emerald-400" />
          Positioning
        </h1>
        <p className="text-xs text-zinc-400">
          You against the {report.competitors_analysed} competitor{report.competitors_analysed === 1 ? '' : 's'} you
          track.{' '}
          <Link href="/dashboard/market/competitors" className="text-emerald-400 hover:text-emerald-300">
            Competitors
          </Link>{' '}
          ·{' '}
          <Link href="/dashboard/market/opportunities" className="text-emerald-400 hover:text-emerald-300">
            Opportunities
          </Link>
        </p>
      </div>

      <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-4">
        <p className="text-sm font-medium text-emerald-200">{report.headline}</p>
        <p className="mt-1 text-xs text-zinc-400">
          Compared using {MENU_SOURCE_COPY[report.tenant.menu_source] ?? 'stored data'} ·{' '}
          {report.tenant.menu_items} dishes on record · generated{' '}
          {new Date(report.generatedAt).toISOString().slice(0, 10)}
        </p>
      </div>

      {report.tenant.menu_source !== 'menu_text' && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-900/70 bg-amber-950/30 p-4 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This comparison is based on {MENU_SOURCE_COPY[report.tenant.menu_source]}.{' '}
            <Link href="/dashboard/settings" className="underline hover:text-amber-100">
              Add your menu in Settings
            </Link>{' '}
            for a dish-by-dish comparison.
          </span>
        </div>
      )}

      {/* ── price positioning ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-100">
          <BarChart3 className="h-4 w-4 text-emerald-400" /> Price positioning
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${band.classes}`}>
            {band.label}
          </span>
        </h2>
        <p className="mb-4 text-xs text-zinc-400">{report.price.summary}</p>

        <ul className="space-y-2">
          {report.price.standings.map((entry) => (
            <li key={`${entry.name}-${entry.distanceKm ?? 'you'}`} className="flex items-center gap-3 text-xs">
              <span className={`w-40 shrink-0 truncate ${entry.isTenant ? 'font-semibold text-emerald-300' : 'text-zinc-300'}`}>
                {entry.name}
                {entry.distanceKm !== null && (
                  <span className="ml-1 text-[10px] text-zinc-500">{entry.distanceKm.toFixed(1)}km</span>
                )}
              </span>
              <span className="h-3 flex-1 overflow-hidden rounded bg-zinc-800">
                <span
                  className={`block h-full ${entry.isTenant ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                  style={{ width: entry.average === null ? '0%' : `${Math.round((entry.average / maxAverage) * 100)}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right text-zinc-400">
                {entry.average === null ? '—' : `R${Math.round(entry.average)}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── rating ranking ────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-100">
          <Trophy className="h-4 w-4 text-emerald-400" /> Rating ranking
          {report.rating.rank !== null && (
            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">
              {report.rating.rank} of {report.rating.total}
            </span>
          )}
        </h2>
        <p className="mb-4 text-xs text-zinc-400">{report.rating.summary}</p>

        <ol className="space-y-1.5">
          {report.rating.standings.map((entry, index) => (
            <li
              key={`${entry.name}-${index}`}
              className={`flex items-center gap-3 rounded-md px-2 py-1.5 text-xs ${
                entry.isTenant ? 'bg-emerald-950/40 text-emerald-200' : 'text-zinc-300'
              }`}
            >
              <span className="w-6 shrink-0 text-right text-zinc-500">{entry.rating === null ? '—' : index + 1}</span>
              <span className={`flex-1 truncate ${entry.isTenant ? 'font-semibold' : ''}`}>{entry.name}</span>
              <span className="inline-flex items-center gap-1 text-amber-300">
                <Star className="h-3 w-3" />
                {entry.rating === null ? 'no rating' : entry.rating.toFixed(1)}
              </span>
              <span className="w-20 shrink-0 text-right text-[10px] text-zinc-500">
                {entry.reviewCount === null ? '' : `${entry.reviewCount} reviews`}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* ── menu overlap ──────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-100">
          <Swords className="h-4 w-4 text-emerald-400" /> Menu overlap
          {report.menu_overlap.average_percent !== null && (
            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">
              avg {report.menu_overlap.average_percent}%
            </span>
          )}
        </h2>
        <p className="mb-4 text-xs text-zinc-400">{report.menu_overlap.summary}</p>

        {report.menu_overlap.per_competitor.length === 0 ? (
          <p className="text-xs text-zinc-500">No competitors tracked yet.</p>
        ) : (
          <ul className="space-y-3">
            {report.menu_overlap.per_competitor.map((entry) => (
              <li key={entry.competitorId}>
                <div className="flex items-center gap-3 text-xs">
                  <span className="w-40 shrink-0 truncate text-zinc-300">{entry.competitorName}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded bg-zinc-800">
                    <span
                      className="block h-full bg-emerald-600"
                      style={{ width: entry.overlapPercent === null ? '0%' : `${entry.overlapPercent}%` }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right text-zinc-400">
                    {entry.overlapPercent === null
                      ? 'not scraped'
                      : `${entry.overlapPercent}% (${entry.sharedItemCount}/${entry.theirItemCount})`}
                  </span>
                </div>
                {entry.sharedItems.length > 0 && (
                  <p className="mt-1 pl-40 text-[10px] text-zinc-600">shared: {entry.sharedItems.join(', ')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── unique offerings ──────────────────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-100">
          <Star className="h-4 w-4 text-emerald-400" /> Unique selling points
          <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">
            {report.unique_offerings.count}
          </span>
        </h2>
        <p className="mb-3 text-xs text-zinc-400">{report.unique_offerings.summary}</p>

        {report.unique_offerings.items.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {report.unique_offerings.items.slice(0, 30).map((item) => (
              <li
                key={item}
                className="rounded-full border border-emerald-900/70 bg-emerald-950/30 px-2.5 py-1 text-[11px] text-emerald-300"
              >
                {item}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
