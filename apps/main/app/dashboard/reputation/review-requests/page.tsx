import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { listRecentRequests, reviewRequestStats } from '@/lib/reputation/review-request-store';

export const dynamic = 'force-dynamic';

function formatDateTime(value: Date | string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function maskPhone(phone: string | null): string | null {
  if (!phone || phone.length < 4) return phone;
  return `•••• ••${phone.slice(-4)}`;
}

/**
 * Gate #13 — review request log. Shows every ask sent in the last 30 days
 * ("127 requests sent this month") plus the totals, so the owner can see
 * the review-generation engine is actually running.
 */
export default async function ReviewRequestsPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const [requests, stats] = await Promise.all([
    listRecentRequests(tenant.id, 30),
    reviewRequestStats(tenant.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
            <MessageSquare className="h-5 w-5 text-emerald-400" />
            Review Requests
          </h1>
          <p className="text-xs text-zinc-400">
            Diners are asked for a Google review 2 hours after their booking — once per visit, never for
            opted-out contacts.{' '}
            <Link href="/dashboard/reputation" className="text-emerald-400 hover:text-emerald-300">
              Back to reviews
            </Link>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Sent this month</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-50">{stats.sentLast30Days}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Sent all-time</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-50">{stats.sentTotal}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Opt-outs honoured</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-300">Always</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Dined</th>
              <th className="px-4 py-3">Asked at</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70 bg-zinc-900/30">
            {requests.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-zinc-400">
                  No review requests sent yet. Once a Google Place ID is configured and diners pass the
                  2-hour mark, asks appear here.
                </td>
              </tr>
            ) : (
              requests.map((row) => (
                <tr key={row.id} className="text-zinc-300">
                  <td className="px-4 py-3">
                    <span className="font-medium text-zinc-100">{row.customerName ?? 'Guest'}</span>
                    {row.customerPhone && (
                      <span className="ml-2 text-xs text-zinc-500">{maskPhone(row.customerPhone)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">{formatDateTime(row.date)}</td>
                  <td className="px-4 py-3 text-xs text-zinc-400">{formatDateTime(row.sentAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
