import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { countProfiles, listProfiles } from '@/lib/customer/profile-store';

export const dynamic = 'force-dynamic';

function formatCents(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`;
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

export default async function CustomersPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const [profiles, total] = await Promise.all([
    listProfiles(tenant.id, 100, 0),
    countProfiles(tenant.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
            <Users className="h-5 w-5 text-emerald-400" />
            Customers
          </h1>
          <p className="text-xs text-zinc-400">
            {total} profile{total === 1 ? '' : 's'} · last 365 days of visits
          </p>
        </div>
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
                  No customer profiles yet. Profiles appear after a reservation is synced.
                </td>
              </tr>
            ) : (
              profiles.map((profile) => (
                <tr key={profile.id} className="hover:bg-zinc-800/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/customers/${encodeURIComponent(profile.customerPhone)}`}
                      className="font-medium text-zinc-100 hover:text-emerald-400"
                    >
                      {profile.customerName || 'Guest'}
                    </Link>
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
