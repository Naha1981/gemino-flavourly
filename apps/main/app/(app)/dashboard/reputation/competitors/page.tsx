import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Swords, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  competitorTrend,
  getRatingHistory,
  listCompetitors,
  recentCompetitorAlerts,
} from '@/lib/reputation/competitor-store';
import { AddCompetitorForm, DeleteCompetitorButton } from './competitor-forms';

export const dynamic = 'force-dynamic';

type CompetitorsPageProps = {
  searchParams?: { selected?: string | string[] };
};

const TREND_META: Record<string, { label: string; classes: string; icon: typeof TrendingUp }> = {
  up: { label: 'Rising', classes: 'border-red-800/70 bg-red-950/60 text-red-300', icon: TrendingUp },
  down: { label: 'Falling', classes: 'border-emerald-800/70 bg-emerald-950/60 text-emerald-300', icon: TrendingDown },
  stable: { label: 'Stable', classes: 'border-app-border-strong bg-app-surface-1/80 text-app-muted', icon: Minus },
};

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

/**
 * Gate #14 — competitor rating monitor. Alerts banner ("⚠️ N competitors
 * had rating drops this week"), the tracked list with trend badges, an Add
 * Competitor form, and the selected competitor's rating history table.
 */
export default async function CompetitorsPage({ searchParams }: CompetitorsPageProps) {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const selectedRaw = Array.isArray(searchParams?.selected) ? searchParams.selected[0] : searchParams?.selected;

  const rows = await listCompetitors(tenant.id);
  const [alerts, ...histories] = await Promise.all([
    recentCompetitorAlerts(tenant.id, 7),
    ...rows.map((row) => getRatingHistory(tenant.id, row.id, 30)),
  ]);

  const competitors = rows.map((row, i) => ({
    row,
    history: histories[i],
    trend: competitorTrend(histories[i]),
  }));

  const selected = competitors.find((c) => c.row.id === selectedRaw) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-app-border pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-app-fg">
            <Swords className="h-5 w-5 text-emerald-400" />
            Competitors
          </h1>
          <p className="text-xs text-app-muted">
            Daily 7am Google rating sweep.{' '}
            <Link href="/dashboard/reputation" className="text-emerald-400 hover:text-emerald-300">
              Back to reviews
            </Link>
          </p>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="rounded-lg border border-amber-900/70 bg-amber-950/30 p-4">
          <p className="text-sm font-medium text-amber-200">
            ⚠️ {alerts.length} competitor{alerts.length === 1 ? '' : 's'} had rating drop
            {alerts.length === 1 ? '' : 's'} this week
          </p>
          <ul className="mt-2 space-y-1">
            {alerts.slice(0, 5).map((alert, i) => (
              <li key={i} className="text-xs leading-relaxed text-amber-300/90">
                {alert}
              </li>
            ))}
          </ul>
        </div>
      )}

      <AddCompetitorForm />

      <div className="space-y-3">
        {competitors.length === 0 ? (
          <div className="rounded-lg border border-dashed border-app-border bg-app-surface-0/30 p-8 text-center text-sm text-app-muted">
            No competitors tracked yet — add one above with its name and Google Place ID.
          </div>
        ) : (
          competitors.map(({ row, trend }) => {
            const meta = TREND_META[trend] ?? TREND_META.stable;
            const TrendIcon = meta.icon;
            return (
              <div key={row.id} className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-app-fg">{row.name}</span>
                  <span className="text-sm text-amber-300">
                    {Number(row.currentRating) > 0 ? Number(row.currentRating).toFixed(1) + '★' : '—'}
                  </span>
                  <span className="text-xs text-app-faint">{row.reviewCount} reviews</span>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.classes}`}>
                    <TrendIcon className="h-3 w-3" /> {meta.label}
                  </span>
                  <span className="ml-auto text-xs text-app-faint">checked {formatDate(row.lastCheckAt)}</span>
                </div>
                <div className="mt-2 flex gap-3 text-xs">
                  <Link
                    href={`/dashboard/reputation/competitors?selected=${row.id}`}
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    Rating history
                  </Link>
                  <DeleteCompetitorButton competitorId={row.id} competitorName={row.name} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {selected && (
        <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
          <p className="mb-3 text-sm font-medium text-app-fg">
            {selected.row.name} — rating history (last 30 days)
          </p>
          {selected.history.length === 0 ? (
            <p className="text-xs text-app-faint">
              No readings yet — the first 7am sweep will record the baseline.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-app-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-app-surface-0/80 text-[10px] uppercase tracking-wide text-app-faint">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Rating</th>
                    <th className="px-3 py-2">Reviews</th>
                    <th className="px-3 py-2">Δ vs previous</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border/70 bg-app-bg/40 text-app-muted">
                  {selected.history.map((reading, i) => {
                    const prev = selected.history[i + 1]; // newest-first ordering
                    const delta = prev ? Number(reading.rating) - Number(prev.rating) : null;
                    return (
                      <tr key={reading.id}>
                        <td className="px-3 py-2 text-app-muted">{formatDate(reading.recordedAt)}</td>
                        <td className="px-3 py-2 text-amber-300">{Number(reading.rating).toFixed(1)}★</td>
                        <td className="px-3 py-2">{reading.reviewCount}</td>
                        <td className="px-3 py-2">
                          {delta === null ? (
                            <span className="text-app-faint">baseline</span>
                          ) : delta < 0 ? (
                            <span className="text-emerald-400">{delta.toFixed(2)}</span>
                          ) : delta > 0 ? (
                            <span className="text-red-400">+{delta.toFixed(2)}</span>
                          ) : (
                            <span className="text-app-faint">0.00</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
