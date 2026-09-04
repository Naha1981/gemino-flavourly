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
    <div className="min-h-screen bg-app-bg text-app-fg p-6 md:p-10 selection:bg-app-surface-1">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center justify-between gap-4 pb-6 border-b border-app-border">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-md bg-app-surface-1 text-app-fg">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
            </span>
            <h1 className="text-xl font-semibold text-app-fg tracking-tight">Platform Analytics</h1>
          </div>
          <Link
            href="/admin"
            className="px-3.5 py-1.5 text-xs font-medium bg-app-surface-0 border border-app-border rounded-md hover:bg-app-surface-1 text-app-fg"
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

        <div className="bg-app-surface-0/70 border border-app-border rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-app-border">
            <h2 className="text-sm font-semibold text-app-fg">Per-Tenant Comparison</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-app-bg text-app-muted font-medium border-b border-app-border">
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
              <tbody className="divide-y divide-app-border/70">
                {!data || data.comparison.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-app-faint">
                      No tenant data available.
                    </td>
                  </tr>
                ) : (
                  data.comparison.map((t) => (
                    <tr key={t.tenantId} className="hover:bg-app-surface-1/40">
                      <td className="px-6 py-4 font-medium text-app-fg">{t.name}</td>
                      <td className="px-6 py-4 text-right text-app-muted">{rands(t.revenueCents30)}</td>
                      <td className="px-6 py-4 text-right text-app-muted">{t.messages30}</td>
                      <td className="px-6 py-4 text-right text-app-muted">{t.customers}</td>
                      <td className="px-6 py-4 text-right text-app-muted">{t.reviews30}</td>
                      <td className="px-6 py-4 text-right text-app-muted">{t.opportunities}</td>
                      <td className="px-6 py-4 text-right text-app-muted">{t.campaigns}</td>
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
    <div className="bg-app-surface-0/70 border border-app-border rounded-lg p-5">
      <p className="text-xs font-medium text-app-muted">{label}</p>
      <p className="text-2xl font-semibold text-app-fg mt-1.5 tracking-tight">{value}</p>
    </div>
  );
}
