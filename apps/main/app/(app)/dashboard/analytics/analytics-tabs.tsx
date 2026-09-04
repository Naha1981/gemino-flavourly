'use client';

import { useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Minus,
  DollarSign,
  Users,
  Star,
  Swords,
  FileText,
  MessageSquare,
  TrendingUp,
} from 'lucide-react';
import type { TenantAnalytics } from '@/lib/analytics/aggregate';
import type { EngineSummary } from '@/lib/analytics/engine';

const ENGINE_ICONS: Record<string, any> = {
  revenue: DollarSign,
  customers: Users,
  reputation: Star,
  market: Swords,
  marketing: FileText,
  operations: MessageSquare,
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
  const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;
  const color =
    direction === 'up' ? 'text-emerald-400' : direction === 'down' ? 'text-rose-400' : 'text-app-faint';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}
    </span>
  );
}

function KpiCard({ summary }: { summary: EngineSummary }) {
  const Icon = ENGINE_ICONS[summary.engine] ?? TrendingUp;
  const title = summary.engine.charAt(0).toUpperCase() + summary.engine.slice(1);
  return (
    <div className="rounded-lg border border-app-border bg-app-surface-0/60 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-app-muted">{title}</span>
        <Icon className="h-4 w-4 text-emerald-400" />
      </div>
      <p className="mt-2 text-2xl font-semibold text-app-fg">{summary.total30.toLocaleString()}</p>
      <div className="mt-3 flex items-center justify-between text-[11px] text-app-faint">
        <span>30d total</span>
        <TrendBadge direction={summary.mom.direction} pct={summary.mom.pctChange} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-app-faint">
        <span>7d: {summary.ma7?.toFixed(1) ?? '0'} · 30d avg: {summary.ma30?.toFixed(1) ?? '0'}</span>
        <TrendBadge direction={summary.wow.direction} pct={summary.wow.pctChange} />
      </div>
    </div>
  );
}

function CohortTable({ cohorts }: { cohorts: TenantAnalytics['cohorts'] }) {
  if (cohorts.length === 0) {
    return <p className="text-sm text-app-faint">No customer cohorts yet. Visits will populate this once customers are tracked.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-app-border">
      <table className="w-full text-xs">
        <thead className="bg-app-bg text-app-muted">
          <tr>
            <th className="px-4 py-2 text-left">Cohort</th>
            <th className="px-4 py-2 text-left">Customers</th>
            {cohorts[0].retention.map((_, i) => (
              <th key={i} className="px-3 py-2 text-right">M{i}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border">
          {cohorts.map((c) => (
            <tr key={c.cohortMonth} className="hover:bg-app-surface-1/40">
              <td className="px-4 py-2 text-app-fg">{c.cohortMonth}</td>
              <td className="px-4 py-2 text-app-muted">{c.cohortSize}</td>
              {c.retention.map((r, i) => (
                <td key={i} className="px-3 py-2 text-right text-app-muted">{r}%</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalyticsTabs({ data }: { data: TenantAnalytics | null }) {
  const [tab, setTab] = useState('overview');
  const analytics = data;

  if (!analytics) {
    return <p className="text-sm text-app-faint">Analytics unavailable right now.</p>;
  }

  const forecast = analytics.forecast;
  const get = (engine: string) => analytics.overview.engines.find((e) => e.engine === engine);

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
                : 'text-app-muted border border-transparent hover:bg-app-surface-1 hover:text-app-fg'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {analytics.overview.engines.map((s) => (
            <KpiCard key={s.engine} summary={s} />
          ))}
        </div>
      )}

      {tab === 'revenue' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard summary={get('revenue')!} />
            <div className="rounded-lg border border-app-border bg-app-surface-0/60 p-4">
              <span className="text-xs font-medium text-app-muted">30-day forecast</span>
              <p className="mt-2 text-2xl font-semibold text-app-fg">
                R{(forecast.forecastCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <p className="mt-3 text-[11px] text-app-faint">
                Trend: {forecast.trend} · fit R² {forecast.r2.toFixed(2)}
              </p>
            </div>
            <div className="rounded-lg border border-app-border bg-app-surface-0/60 p-4">
              <span className="text-xs font-medium text-app-muted">Daily slope</span>
              <p className="mt-2 text-2xl font-semibold text-app-fg">{forecast.slope.toFixed(1)}</p>
              <p className="mt-3 text-[11px] text-app-faint">cents/day (linear regression)</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'customers' && (
        <div className="space-y-4">
          {get('customers') && <KpiCard summary={get('customers')!} />}
          <CohortTable cohorts={analytics.cohorts} />
        </div>
      )}

      {tab === 'reputation' && get('reputation') && <KpiCard summary={get('reputation')!} />}
      {tab === 'market' && get('market') && <KpiCard summary={get('market')!} />}
      {tab === 'marketing' && get('marketing') && <KpiCard summary={get('marketing')!} />}
    </div>
  );
}
