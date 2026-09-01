'use client';

import { useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Users,
  Star,
  Swords,
  FileText,
  MessageSquare,
  TrendingUp,
  Banknote,
} from 'lucide-react';
import type { TenantAnalytics } from '@/lib/analytics/aggregate';
import type { EngineSummary } from '@/lib/analytics/engine';
import { formatEngineTotal, formatMa, trendBadgeLabel, formatRand } from '@/lib/format/rand';
import { sampleChipLabel } from '@/lib/dashboard/kpi';

const ENGINE_ICONS: Record<string, any> = {
  revenue: Banknote,
  customers: Users,
  reputation: Star,
  market: Swords,
  marketing: FileText,
  operations: MessageSquare,
};

// UI-3R / F7 (S16) — owner language: the engines report under plain labels.
// "Operations" meant nothing to a restaurant owner; "Conversations" is what
// the tile actually counts (messages handled in the inbox).
const ENGINE_LABELS: Record<string, string> = {
  revenue: 'Revenue',
  customers: 'Customers',
  reputation: 'Reputation',
  market: 'Market',
  marketing: 'Marketing',
  operations: 'Conversations',
};

// UI-3R / F3 (S16) — every tab gets an honest empty state keyed to how its
// data is born, so a number-only tile never stands in for analytics.
const ENGINE_EMPTY_STATES: Record<string, string> = {
  revenue: 'No verified revenue yet — it appears after your first WhatsApp booking.',
  customers: 'No guests yet — they appear after their first booking.',
  reputation: 'No reviews yet — they appear once your Google Place ID is connected.',
  market: 'No market data yet — add competitors and the sweeps will fill this in.',
  marketing: 'No campaigns yet — launch one in Marketing and results land here.',
  operations: 'No conversations yet — connect WhatsApp and the AI starts answering.',
};

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'customers', label: 'Customers' },
  { key: 'reputation', label: 'Reputation' },
  { key: 'market', label: 'Market' },
  { key: 'marketing', label: 'Marketing' },
];

function TrendBadge({ direction, pct }: { direction: string; pct: number | null }) {
  // UI-3R / F7 (S15) — a null percentage renders NOTHING at all. The old
  // "↑ —" placeholder was a broken badge pretending to be a trend.
  const label = trendBadgeLabel(pct);
  if (label === null) return null;
  const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : TrendingUp;
  const color =
    direction === 'up' ? 'text-emerald-400' : direction === 'down' ? 'text-rose-400' : 'text-zinc-500';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function SampleChip({ demoMode }: { demoMode: boolean }) {
  const label = sampleChipLabel(demoMode);
  if (!label) return null;
  return (
    <span className="rounded-full border border-amber-600/60 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">
      {label}
    </span>
  );
}

function KpiCard({ summary, demoMode }: { summary: EngineSummary; demoMode: boolean }) {
  const Icon = ENGINE_ICONS[summary.engine] ?? TrendingUp;
  const title = ENGINE_LABELS[summary.engine] ?? summary.engine.charAt(0).toUpperCase() + summary.engine.slice(1);
  const hasData = summary.total30 > 0 || (summary.ma7 ?? 0) > 0 || (summary.ma30 ?? 0) > 0;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">{title}</span>
        <div className="flex items-center gap-2">
          <SampleChip demoMode={demoMode} />
          <Icon className="h-4 w-4 text-emerald-400" />
        </div>
      </div>
      {hasData ? (
        <>
          <p className="mt-2 text-2xl font-semibold text-zinc-50">{formatEngineTotal(summary.engine, summary.total30)}</p>
          <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
            <span>30d total</span>
            <TrendBadge direction={summary.mom.direction} pct={summary.mom.pctChange} />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
            <span>7d: {formatMa(summary.engine, summary.ma7 ?? 0)} · 30d avg: {formatMa(summary.engine, summary.ma30 ?? 0)}</span>
            <TrendBadge direction={summary.wow.direction} pct={summary.wow.pctChange} />
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-zinc-500">
          {ENGINE_EMPTY_STATES[summary.engine] ?? 'No data yet — this fills in as your restaurant works.'}
        </p>
      )}
    </div>
  );
}

function CohortTable({ cohorts }: { cohorts: TenantAnalytics['cohorts'] }) {
  if (cohorts.length === 0) {
    return <p className="text-sm text-zinc-500">No customer cohorts yet. Visits will populate this once customers are tracked.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-xs">
        <thead className="bg-zinc-950 text-zinc-400">
          <tr>
            <th className="px-4 py-2 text-left">Cohort</th>
            <th className="px-4 py-2 text-left">Customers</th>
            {cohorts[0].retention.map((_, i) => (
              <th key={i} className="px-3 py-2 text-right">M{i}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {cohorts.map((c) => (
            <tr key={c.cohortMonth} className="hover:bg-zinc-800/40">
              <td className="px-4 py-2 text-zinc-200">{c.cohortMonth}</td>
              <td className="px-4 py-2 text-zinc-300">{c.cohortSize}</td>
              {c.retention.map((r, i) => (
                <td key={i} className="px-3 py-2 text-right text-zinc-400">{r}%</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalyticsTabs({ data, demoMode }: { data: TenantAnalytics | null; demoMode: boolean }) {
  const [tab, setTab] = useState('overview');
  const analytics = data;

  if (!analytics) {
    return <p className="text-sm text-zinc-500">Analytics unavailable right now.</p>;
  }

  const forecast = analytics.forecast;
  const get = (engine: string) => analytics.overview.engines.find((e) => e.engine === engine);
  const revenue = get('revenue');
  const revenueHasData = Boolean(revenue && (revenue.total30 > 0 || (revenue.ma7 ?? 0) > 0));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.key
                ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800'
                : 'text-zinc-400 border border-transparent hover:bg-zinc-800 hover:text-zinc-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {analytics.overview.engines.map((s) => (
            <KpiCard key={s.engine} summary={s} demoMode={demoMode} />
          ))}
        </div>
      )}

      {tab === 'revenue' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {revenue && <KpiCard summary={revenue} demoMode={demoMode} />}
            {revenueHasData ? (
              <>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                  <span className="text-xs font-medium text-zinc-400">30-day forecast</span>
                  <p className="mt-2 text-2xl font-semibold text-zinc-50">
                    {formatRand(forecast.forecastCents)}
                  </p>
                  <p className="mt-3 text-[11px] text-zinc-500">
                    Trend: {forecast.trend} · fit R² {forecast.r2.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                  <span className="text-xs font-medium text-zinc-400">Daily slope</span>
                  <p className="mt-2 text-2xl font-semibold text-zinc-50">{formatRand(Math.round(forecast.slope))}</p>
                  <p className="mt-3 text-[11px] text-zinc-500">per day (linear regression)</p>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6 sm:col-span-2">
                <p className="text-sm leading-relaxed text-zinc-400">
                  {ENGINE_EMPTY_STATES.revenue}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'customers' && (
        <div className="space-y-4">
          {get('customers') && <KpiCard summary={get('customers')!} demoMode={demoMode} />}
          <CohortTable cohorts={analytics.cohorts} />
        </div>
      )}

      {tab === 'reputation' && get('reputation') && <KpiCard summary={get('reputation')!} demoMode={demoMode} />}
      {tab === 'market' && get('market') && <KpiCard summary={get('market')!} demoMode={demoMode} />}
      {tab === 'marketing' && get('marketing') && <KpiCard summary={get('marketing')!} demoMode={demoMode} />}
    </div>
  );
}
