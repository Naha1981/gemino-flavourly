import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Users, Crown, Gift, Sparkles, TrendingUp } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { countBySegment } from '@/lib/customer/segmentation-store';
import { normalizeCustomerSegment, type CustomerSegment } from '@/lib/customer/segmentation';
import { countProfiles, listProfiles } from '@/lib/customer/profile-store';
import { customersAtRiskEmptyState, segmentShare } from '@/lib/dashboard/kpi';
import { isDemoModeActive } from '@/lib/demo/demo-mode';

export const dynamic = 'force-dynamic';

type CustomersPageProps = {
  searchParams?: { segment?: string | string[] };
};

const FILTER_OPTIONS: Array<{ value: CustomerSegment | ''; label: string }> = [
  { value: '', label: 'All segments' },
  { value: 'vip', label: 'VIP only' },
  { value: 'regular', label: 'Regular only' },
  { value: 'at_risk', label: 'At-risk only' },
  { value: 'dormant', label: 'Dormant only' },
  { value: 'new', label: 'New only' },
];

const SEGMENT_META: Record<
  CustomerSegment,
  { label: string; classes: string }
> = {
  vip: {
    label: 'VIP',
    classes: 'border-stitch-gold/60 bg-stitch-gold/10 text-stitch-brass dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-300',
  },
  regular: {
    label: 'Regular',
    classes: 'border-app-tertiary-container/60 bg-app-tertiary-container/20 text-app-tertiary dark:border-blue-800/70 dark:bg-blue-950/60 dark:text-blue-300',
  },
  at_risk: {
    label: 'At-risk',
    classes: 'border-app-error/50 bg-app-error-container/50 text-app-error dark:border-orange-800/70 dark:bg-orange-950/60 dark:text-orange-300',
  },
  dormant: {
    label: 'Dormant',
    classes: 'border-app-border bg-app-surface-2 text-app-muted dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-400',
  },
  new: {
    label: 'New',
    classes: 'border-app-secondary-container bg-app-secondary-container/40 text-app-on-secondary-container dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
};

function formatR(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

function SegmentBadge({ segment }: { segment: string | null | undefined }) {
  const normalized = normalizeCustomerSegment(segment) ?? 'new';
  const meta = SEGMENT_META[normalized];
  return (
    <span
      title={`${meta.label} segment`}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.classes}`}
    >
      {meta.label}
    </span>
  );
}

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const rawSegment = Array.isArray(searchParams?.segment)
    ? searchParams.segment[0]
    : searchParams?.segment;
  const selectedSegment = normalizeCustomerSegment(rawSegment);

  // UI-3R / F2 — LIVE views exclude deadbeef demo profiles; Demo Mode ON
  // includes the seed dataset (amber banner renders in the shared layout).
  const demoMode = await isDemoModeActive();
  const liveScope = { includeDemoRows: demoMode };

  const [profiles, total, segmentCounts, vipSpotlight, atRiskList] = await Promise.all([
    listProfiles(tenant.id, 100, 0, selectedSegment, liveScope),
    countProfiles(tenant.id, selectedSegment, liveScope),
    countBySegment(tenant.id, liveScope),
    listProfiles(tenant.id, 5, 0, 'vip', liveScope),
    listProfiles(tenant.id, 5, 0, 'at_risk', liveScope),
  ]);

  // UI-3R / F5 (S8) — zero-count segments render no percentage chip and no
  // bar at all: a gold 0% line reads as data on an empty guest book.
  const totalProfiles =
    segmentCounts.vip + segmentCounts.regular + segmentCounts.at_risk + segmentCounts.dormant + segmentCounts.new;

  const cohorts: { label: string; count: number; bar: string; chip: string; share: number | null }[] = [
    {
      label: 'VIP',
      count: segmentCounts.vip,
      bar: 'bg-stitch-gold',
      chip: 'bg-stitch-gold/15 text-stitch-brass dark:text-stitch-gold',
      share: segmentShare(segmentCounts.vip, totalProfiles),
    },
    {
      label: 'Regular',
      count: segmentCounts.regular,
      bar: 'bg-app-secondary dark:bg-emerald-500',
      chip: 'bg-app-secondary-container text-app-on-secondary-container dark:bg-emerald-950 dark:text-emerald-300',
      share: segmentShare(segmentCounts.regular, totalProfiles),
    },
    {
      label: 'At-risk',
      count: segmentCounts.at_risk,
      bar: 'bg-app-error dark:bg-orange-400',
      chip: 'bg-app-error-container text-app-error dark:bg-orange-950 dark:text-orange-300',
      share: segmentShare(segmentCounts.at_risk, totalProfiles),
    },
    {
      label: 'Dormant',
      count: segmentCounts.dormant,
      bar: 'bg-app-border-strong dark:bg-zinc-600',
      chip: 'bg-app-surface-3 text-app-muted dark:bg-zinc-800 dark:text-zinc-400',
      share: segmentShare(segmentCounts.dormant, totalProfiles),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-app-border pb-4 md:flex-row md:items-center md:justify-between dark:border-zinc-800">
        <div>
          <h1 className="headline-md flex items-center gap-2 text-app-fg dark:text-zinc-50">
            <Users className="h-5 w-5 text-app-secondary dark:text-emerald-400" />
            Customer Intelligence
          </h1>
          <p className="label-sm mt-1 text-app-muted dark:text-zinc-400">
            {total} profile{total === 1 ? '' : 's'} · last 365 days of visits ·{' '}
            <Link href="/dashboard/customers/reactivation" className="text-app-secondary hover:opacity-80 dark:text-emerald-400 dark:hover:text-emerald-300">
              reactivation campaigns
            </Link>
          </p>
        </div>

        <form method="get" className="flex items-end gap-2">
          <div>
            <label htmlFor="segment-filter" className="label-sm mb-1 block uppercase tracking-wide text-app-faint dark:text-zinc-500">
              Segment
            </label>
            <select
              id="segment-filter"
              name="segment"
              defaultValue={selectedSegment ?? ''}
              className="rounded-lg border border-app-border bg-app-surface-0 px-3 py-2 text-xs text-app-fg outline-none focus:border-stitch-gold dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-emerald-600"
            >
              {FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg border border-app-border bg-app-surface-2 px-3 py-2 text-xs font-medium text-app-fg hover:bg-app-surface-3 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Apply
          </button>
        </form>
      </div>

      {/* Segment counts (at-a-glance strip) */}
      <div className="glass-card px-4 py-3 text-xs text-app-muted dark:text-zinc-300">
        <span className="font-medium text-stitch-brass dark:text-amber-300">VIP: {segmentCounts.vip}</span>
        <span className="mx-2 text-app-border-strong dark:text-zinc-600">|</span>
        <span className="font-medium text-app-tertiary dark:text-blue-300">Regular: {segmentCounts.regular}</span>
        <span className="mx-2 text-app-border-strong dark:text-zinc-600">|</span>
        <span className="font-medium text-app-error dark:text-orange-300">At-risk: {segmentCounts.at_risk}</span>
        <span className="mx-2 text-app-border-strong dark:text-zinc-600">|</span>
        <span className="font-medium text-app-muted dark:text-zinc-400">Dormant: {segmentCounts.dormant}</span>
        <span className="mx-2 text-app-border-strong dark:text-zinc-600">|</span>
        <span className="font-medium text-app-secondary dark:text-emerald-300">New: {segmentCounts.new}</span>
      </div>

      {/* Segment cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cohorts.map((c) => (
          <Link key={c.label} href={`/dashboard/customers?segment=${c.label === 'VIP' ? 'vip' : c.label === 'Regular' ? 'regular' : c.label === 'At-risk' ? 'at_risk' : 'dormant'}`} className="glass-card group p-5">
            <div className="flex items-center justify-between">
              <span className="label-md text-app-muted dark:text-zinc-400">{c.label}</span>
              {c.share !== null && (
                <span className={`label-sm rounded-full px-2 py-0.5 ${c.chip}`}>{c.share}%</span>
              )}
            </div>
            <p className="headline-lg mt-2 text-app-fg dark:text-zinc-50">{c.count}</p>
            {c.count > 0 && (
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-app-surface-2 dark:bg-zinc-800">
                <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${Math.min(100, (c.count / (totalProfiles || 1)) * 100)}%` }} />
              </div>
            )}
            {c.count === 0 && <p className="label-sm mt-3 text-app-faint dark:text-zinc-600">—</p>}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* VIP Spotlight */}
        <div className="glass-card border-t-4 !border-t-stitch-gold p-6">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-stitch-gold" />
            <h2 className="label-md text-app-fg dark:text-zinc-50">VIP Spotlight</h2>
          </div>
          {vipSpotlight.length === 0 ? (
            <p className="body-md mt-4 text-app-muted dark:text-zinc-400">No VIP profiles yet — they appear as visits sync.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {vipSpotlight.map((p) => (
                <li key={p.id} className="rounded-xl border border-app-border bg-app-surface-1 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center justify-between">
                    <span className="label-md text-app-fg dark:text-zinc-100">{p.customerName || 'Guest'}</span>
                    <span className="label-sm text-stitch-brass dark:text-stitch-gold">{p.totalVisits} visits</span>
                  </div>
                  <div className="label-sm mt-1 flex items-center gap-2 text-app-muted dark:text-zinc-400">
                    <TrendingUp className="h-3 w-3 text-app-secondary dark:text-emerald-400" />
                    LTV {formatR(p.totalSpendCents)} · last visit {formatDate(p.lastVisitAt)}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Link
                      href={`/dashboard/customers/${encodeURIComponent(p.customerPhone)}`}
                      className="label-sm inline-flex items-center gap-1 rounded-lg bg-stitch-gold px-3 py-1.5 font-semibold text-zinc-950 hover:opacity-90"
                    >
                      <Gift className="h-3 w-3" /> Gift
                    </Link>
                    <Link
                      href={`/dashboard/customers/${encodeURIComponent(p.customerPhone)}`}
                      className="label-sm inline-flex items-center gap-1 rounded-lg border border-app-secondary px-3 py-1.5 font-semibold text-app-secondary hover:bg-app-secondary-container/40 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    >
                      <Sparkles className="h-3 w-3" /> Personalize
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* At-risk reactivation */}
        <div className="glass-card border-t-4 !border-t-app-error p-6 dark:!border-t-red-500">
          <div className="flex items-center justify-between">
            <h2 className="label-md text-app-fg dark:text-zinc-50">At-Risk — win them back</h2>
            <Link href="/dashboard/customers/reactivation" className="label-sm text-app-secondary hover:opacity-80 dark:text-emerald-400">
              Reactivation →
            </Link>
          </div>
          {atRiskList.length === 0 ? (
            <p className="body-md mt-4 text-app-muted dark:text-zinc-400">{customersAtRiskEmptyState(totalProfiles)}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {atRiskList.map((p) => (
                <li key={p.id} className="rounded-xl border border-app-border bg-app-surface-1 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center justify-between">
                    <span className="label-md text-app-fg dark:text-zinc-100">{p.customerName || 'Guest'}</span>
                    <span className="label-sm text-app-error dark:text-orange-300">last visit {formatDate(p.lastVisitAt)}</span>
                  </div>
                  <div className="label-sm mt-1 text-app-muted dark:text-zinc-400">
                    {p.totalVisits} visits · {formatR(p.totalSpendCents)} lifetime
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Full table (unchanged data, restyled) */}
      <div className="overflow-hidden rounded-2xl border border-app-border bg-app-surface-0 dark:border-zinc-800 dark:bg-zinc-900/70">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-app-border text-xs uppercase tracking-wide text-app-faint dark:border-zinc-800 dark:text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Visits</th>
              <th className="px-4 py-3 font-medium">Spend</th>
              <th className="px-4 py-3 font-medium">Last visit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border/70 dark:divide-zinc-800/80">
            {profiles.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-xs text-app-faint dark:text-zinc-500">
                  No customer profiles match this segment. Profiles appear after a reservation is synced.
                </td>
              </tr>
            ) : (
              profiles.map((profile) => (
                <tr key={profile.id} className="hover:bg-app-surface-1 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/customers/${encodeURIComponent(profile.customerPhone)}`}
                        className="font-medium text-app-fg hover:text-stitch-brass dark:text-zinc-100 dark:hover:text-emerald-400"
                      >
                        {profile.customerName || 'Guest'}
                      </Link>
                      <SegmentBadge segment={profile.segment} />
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-app-muted dark:text-zinc-400">{profile.customerPhone}</td>
                  <td className="px-4 py-3 text-app-fg dark:text-zinc-200">{profile.totalVisits}</td>
                  <td className="px-4 py-3 text-app-fg dark:text-zinc-200">{formatR(profile.totalSpendCents)}</td>
                  <td className="px-4 py-3 text-app-muted dark:text-zinc-400">{formatDate(profile.lastVisitAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
