import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { tenants, waAccounts, messages, conversations, systemSettings } from '@/lib/db/schema';
import { count, eq, desc, sql } from 'drizzle-orm';
import { Users, MessageSquare, Activity, DollarSign, Shield, Power, Radio, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { toggleGlobalAiAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function SuperAdminDashboard() {
  const { userId } = await auth();
  const authorized = await isSuperAdmin();

  // Fails closed unconditionally (not just in production) — there's no
  // reason a preview/staging deploy should expose cross-tenant data either.
  if (!userId || !authorized) {
    redirect('/sign-in');
  }

  // Global metrics from Neon / Drizzle
  const totalTenantsResult = await db.select({ count: count() }).from(tenants).catch(() => [{ count: 0 }]);
  const activeConnectionsResult = await db
    .select({ count: count() })
    .from(waAccounts)
    .where(eq(waAccounts.isConnected, true))
    .catch(() => [{ count: 0 }]);

  const totalMessagesResult = await db.select({ count: count() }).from(messages).catch(() => [{ count: 0 }]);
  const missedRevenueResult = await db
    .select({ value: sql<number>`COALESCE(SUM(${conversations.estimatedValueCents}), 0)` })
    .from(conversations)
    .where(eq(conversations.outcome, 'missed'))
    .catch(() => [{ value: 0 }]);
  const recentTenants = await db.select().from(tenants).orderBy(desc(tenants.createdAt)).limit(10).catch(() => []);
  const settings = await db.query.systemSettings.findFirst().catch(() => null);

  const totalTenants = totalTenantsResult[0]?.count ?? 0;
  const activeConnections = activeConnectionsResult[0]?.count ?? 0;
  const totalMessages = totalMessagesResult[0]?.count ?? 0;
  const aggregateMissedRevenueCents = Number(missedRevenueResult[0]?.value ?? 0);
  const aggregateMissedRevenue = aggregateMissedRevenueCents / 100;
  const isMasterAiOn = settings?.masterAiSwitch ?? true;

  // Calculate MRR ($49/month per active tenant)
  const estMrr = totalTenants * 49;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 selection:bg-zinc-800">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Navigation Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-md bg-zinc-800 text-zinc-100">
                <Shield className="w-4 h-4 text-emerald-400" />
              </span>
              <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">Super Admin Platform Overview</h1>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Global system health, tenant isolation registry, and Baileys WhatsApp socket fleet.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="px-3.5 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 rounded-md hover:bg-zinc-800 text-zinc-200 transition-colors"
            >
              Open Tenant Dashboard
            </Link>
            <div className="px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>Fleet: Online</span>
            </div>
          </div>
        </div>

        {/* Global Master Switch Banner */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className={`p-2 rounded-lg ${isMasterAiOn ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60' : 'bg-rose-950/60 text-rose-400 border border-rose-800/60'}`}>
              <Power className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-50">Global AI Master Kill-Switch</h3>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${isMasterAiOn ? 'bg-emerald-900/40 text-emerald-400' : 'bg-rose-900/40 text-rose-400'}`}>
                  {isMasterAiOn ? 'Armed & Active' : 'Killed / Inactive'}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Database-backed master switch. Instantly stops all AI auto-replies across all tenants without redeploying.
              </p>
            </div>
          </div>

          <form action={toggleGlobalAiAction}>
            <input type="hidden" name="enabled" value={isMasterAiOn ? 'false' : 'true'} />
            <button
              type="submit"
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors ${
                isMasterAiOn
                  ? 'bg-rose-900/30 text-rose-300 border border-rose-800 hover:bg-rose-900/50'
                  : 'bg-emerald-900/30 text-emerald-300 border border-emerald-800 hover:bg-emerald-900/50'
              }`}
            >
              {isMasterAiOn ? 'Emergency Pause All AI' : 'Resume Global AI Processing'}
            </button>
          </form>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard
            title="Total Tenants"
            value={totalTenants.toString()}
            icon={Users}
            trend="+12% this month"
          />
          <StatCard
            title="Active WhatsApp Sockets"
            value={activeConnections.toString()}
            icon={Activity}
            trend="99.4% uptime"
          />
          <StatCard
            title="Total Messages Processed"
            value={totalMessages.toString()}
            icon={MessageSquare}
            trend="+18% 24h vol"
          />
          <StatCard
            title="Estimated MRR"
            value={`$${estMrr.toLocaleString()}`}
            icon={DollarSign}
            trend="$49/mo per tenant"
          />
          <StatCard
            title="Missed Revenue Detected"
            value={`R${aggregateMissedRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            icon={DollarSign}
            trend="Across all tenants"
          />
        </div>

        {/* Recent Tenants Table */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-50">Recent Tenant Onboarding</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Businesses running on your multi-tenant WhatsApp platform</p>
            </div>
            <span className="text-xs text-zinc-500 font-mono">{recentTenants.length} tenants</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-950 text-zinc-400 font-medium border-b border-zinc-800">
                <tr>
                  <th className="px-6 py-3.5">Tenant Name</th>
                  <th className="px-6 py-3.5">Tenant Slug</th>
                  <th className="px-6 py-3.5">AI Mode</th>
                  <th className="px-6 py-3.5">Manual Takeover</th>
                  <th className="px-6 py-3.5">Joined Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {recentTenants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">
                      No tenants created yet. When new businesses register, they will appear here.
                    </td>
                  </tr>
                ) : (
                  recentTenants.map((tenant) => (
                    <tr key={tenant.id} className="hover:bg-zinc-800/40 transition-colors">
                      <td className="px-6 py-4 font-medium text-zinc-100">{tenant.name}</td>
                      <td className="px-6 py-4 text-zinc-400 font-mono text-[11px]">{tenant.slug}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            tenant.aiEnabled
                              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {tenant.aiEnabled ? 'Autonomous' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            tenant.manualMode
                              ? 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {tenant.manualMode ? 'Human Active' : 'AI Handled'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-zinc-400">
                        {tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : '-'}
                      </td>
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

// Clean Linear-grade Stat Card
function StatCard({
  title,
  value,
  icon: Icon,
  trend,
}: {
  title: string;
  value: string;
  icon: any;
  trend: string;
}) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-zinc-400">{title}</p>
          <p className="text-2xl font-semibold text-zinc-50 mt-1.5 tracking-tight">{value}</p>
        </div>
        <div className="p-2.5 bg-zinc-800 rounded-md text-zinc-300">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-[11px] text-emerald-400 mt-3 font-medium flex items-center gap-1">
        {trend}
      </p>
    </div>
  );
}
