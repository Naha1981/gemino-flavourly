import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { countBySegment } from '@/lib/customer/segmentation-store';
import { normalizeCustomerSegment, type CustomerSegment } from '@/lib/customer/segmentation';
import { countProfiles, listProfiles } from '@/lib/customer/profile-store';

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
    classes: 'border-amber-800/70 bg-amber-950/60 text-amber-300',
  },
  regular: {
    label: 'Regular',
    classes: 'border-blue-800/70 bg-blue-950/60 text-blue-300',
  },
  at_risk: {
    label: 'At-risk',
    classes: 'border-orange-800/70 bg-orange-950/60 text-orange-300',
  },
  dormant: {
    label: 'Dormant',
    classes: 'border-zinc-700 bg-zinc-800/80 text-zinc-400',
  },
  new: {
    label: 'New',
    classes: 'border-emerald-800/70 bg-emerald-950/60 text-emerald-300',
  },
};

function formatCents(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`;
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

  const [profiles, total, segmentCounts] = await Promise.all([
    listProfiles(tenant.id, 100, 0, selectedSegment),
    countProfiles(tenant.id, selectedSegment),
    countBySegment(tenant.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
            <Users className="h-5 w-5 text-emerald-400" />
            Customers
          </h1>
          <p className="text-xs text-zinc-400">
            {total} profile{total === 1 ? '' : 's'} · last 365 days of visits ·{' '}
            <Link href="/dashboard/customers/reactivation" className="text-emerald-400 hover:text-emerald-300">
              reactivation campaigns
            </Link>
          </p>
        </div>

        <form method="get" className="flex items-end gap-2">
          <div>
            <label htmlFor="segment-filter" className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
              Segment
            </label>
            <select
              id="segment-filter"
              name="segment"
              defaultValue={selectedSegment ?? ''}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-600"
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
            className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          >
            Apply
          </button>
        </form>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-xs text-zinc-300">
        <span className="font-medium text-amber-300">VIP: {segmentCounts.vip}</span>
        <span className="mx-2 text-zinc-600">|</span>
        <span className="font-medium text-blue-300">Regular: {segmentCounts.regular}</span>
        <span className="mx-2 text-zinc-600">|</span>
        <span className="font-medium text-orange-300">At-risk: {segmentCounts.at_risk}</span>
        <span className="mx-2 text-zinc-600">|</span>
        <span className="font-medium text-zinc-400">Dormant: {segmentCounts.dormant}</span>
        <span className="mx-2 text-zinc-600">|</span>
        <span className="font-medium text-emerald-300">New: {segmentCounts.new}</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/70">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Visits</th>
              <th className="px-4 py-3 font-medium">Spend</th>
              <th className="px-4 py-3 font-medium">Last visit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/80">
            {profiles.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-xs text-zinc-500">
                  No customer profiles match this segment. Profiles appear after a reservation is synced.
                </td>
              </tr>
            ) : (
              profiles.map((profile) => (
                <tr key={profile.id} className="hover:bg-zinc-800/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/customers/${encodeURIComponent(profile.customerPhone)}`}
                        className="font-medium text-zinc-100 hover:text-emerald-400"
                      >
                        {profile.customerName || 'Guest'}
                      </Link>
                      <SegmentBadge segment={profile.segment} />
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">{profile.customerPhone}</td>
                  <td className="px-4 py-3 text-zinc-200">{profile.totalVisits}</td>
                  <td className="px-4 py-3 text-zinc-200">{formatCents(profile.totalSpendCents)}</td>
                  <td className="px-4 py-3 text-zinc-400">{formatDate(profile.lastVisitAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
