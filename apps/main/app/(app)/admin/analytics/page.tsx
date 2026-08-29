import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { fetchPlatformAnalytics } from '@/lib/analytics/platform';

export const dynamic = 'force-dynamic';

function rands(cents: number): string {
  return `R${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default async function SuperAdminAnalyticsPage() {
  const { userId } = await auth();
  const authorized = await isSuperAdmin();
  if (!userId || !authorized) redirect('/sign-in');

  const data = await fetchPlatformAnalytics().catch(() => null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 selection:bg-zinc-800">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-md bg-zinc-800 text-zinc-100">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
            </span>
            <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">Platform Analytics</h1>
          </div>
          <Link
            href="/admin"
            className="px-3.5 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 rounded-md hover:bg-zinc-800 text-zinc-200"
          >
            Back to Overview
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Stat label="Tenants" value={data ? data.tenants.toString() : '0'} />
          <Stat label="Revenue (30d)" value={data ? rands(data.revenueCents30) : 'R0'} />
          <Stat label="Messages (30d)" value={data ? data.messages30.toString() : '0'} />
          <Stat label="Reviews (30d)" value={data ? data.reviews30.toString() : '0'} />
          <Stat label="Opportunities" value={data ? data.opportunities.toString() : '0'} />
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-50">Per-Tenant Comparison</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-950 text-zinc-400 font-medium border-b border-zinc-800">
                <tr>
                  <th className="px-6 py-3.5">Tenant</th>
                  <th className="px-6 py-3.5 text-right">Revenue 30d</th>
                  <th className="px-6 py-3.5 text-right">Messages 30d</th>
                  <th className="px-6 py-3.5 text-right">Customers</th>
                  <th className="px-6 py-3.5 text-right">Reviews 30d</th>
                  <th className="px-6 py-3.5 text-right">Opportunities</th>
                  <th className="px-6 py-3.5 text-right">Campaigns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {!data || data.comparison.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-zinc-500">
                      No tenant data available.
                    </td>
                  </tr>
                ) : (
                  data.comparison.map((t) => (
                    <tr key={t.tenantId} className="hover:bg-zinc-800/40">
                      <td className="px-6 py-4 font-medium text-zinc-100">{t.name}</td>
                      <td className="px-6 py-4 text-right text-zinc-300">{rands(t.revenueCents30)}</td>
                      <td className="px-6 py-4 text-right text-zinc-300">{t.messages30}</td>
                      <td className="px-6 py-4 text-right text-zinc-300">{t.customers}</td>
                      <td className="px-6 py-4 text-right text-zinc-300">{t.reviews30}</td>
                      <td className="px-6 py-4 text-right text-zinc-300">{t.opportunities}</td>
                      <td className="px-6 py-4 text-right text-zinc-300">{t.campaigns}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
      <p className="text-xs font-medium text-zinc-400">{label}</p>
      <p className="text-2xl font-semibold text-zinc-50 mt-1.5 tracking-tight">{value}</p>
    </div>
  );
}
