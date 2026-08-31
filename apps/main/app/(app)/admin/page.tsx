import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { tenants, waAccounts, messages, conversations, systemSettings } from '@/lib/db/schema';
import { count, eq, desc, sql } from 'drizzle-orm';
import { Users, MessageSquare, Activity, DollarSign, Shield, Power, Radio, RefreshCw, CalendarX, Target, TrendingUp, Star, Swords, TrendingDown, Lightbulb, BellRing } from 'lucide-react';
import Link from 'next/link';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { analyzeDayAggregates, computeSlowDayWindow, totalSlowDays, type DayAggregate } from '@/lib/revenue/slow-days';
import { fetchSlowDayAggregatesByTenant } from '@/lib/revenue/slow-days-store';
import { totalTopPriorityValueCents } from '@/lib/revenue/priorities';
import { calculatePlatformOpportunity, type OpportunityInputs } from '@/lib/revenue/opportunity';
import { fetchCrossTenantOpportunityInputs } from '@/lib/revenue/opportunity-store';
import { emptySegmentCounts, fetchCrossTenantSegmentCounts } from '@/lib/customer/segmentation-store';
import { countVipAlertsToday } from '@/lib/customer/vip-store';
import { countRatingDropAlertsThisWeek } from '@/lib/reputation/competitor-store';
import {
  countAllMarketCompetitors,
  countCompetitorsWithPlaceId,
  countMarketAlertsThisWeek,
} from '@/lib/market/competitor-store';
import { countAllOpportunities } from '@/lib/market/opportunity-store';
import { toggleGlobalAiAction } from './actions';
import { CronFleetManager } from '@/components/cron-fleet-manager';
import { DemoControls } from '@/components/demo-controls';
import { DemoModeBar } from '@/components/demo-mode-bar';
import { isDemoModeActive } from '@/lib/demo/demo-mode';
import {
  DEMO_PLATFORM_KPIS,
  DEMO_TENANTS,
} from '@/lib/demo/seed-data';
import { cronKeyConfigured } from '@/lib/cron/key-store-server';
import { loadCanonicalFleet } from '@/lib/cron/canonical-fleet';

export const dynamic = 'force-dynamic';

export default async function SuperAdminDashboard() {
  const { userId } = await auth();
  const authorized = await isSuperAdmin();

  // Fails closed unconditionally (not just in production) — there's no
  // reason a preview/staging deploy should expose cross-tenant data either.
  if (!userId || !authorized) {
    redirect('/sign-in');
  }

  // GATE 2 — Demo Mode: when the (super-admin-gated) demo cookie is on,
  // every metric below comes from the deterministic seed dataset in
  // lib/demo/seed-data.ts instead of Neon. The database is never written
  // to and never read from in this branch — view-only by construction.
  const demoMode = await isDemoModeActive();

  // Global metrics from Neon / Drizzle — skipped entirely in Demo Mode
  // (the branch below replaces every business metric with seed values;
  // only infrastructure controls — kill-switch, cron key, fleet — stay
  // live so the page remains operable while demoing).
  const totalTenantsResult = demoMode ? [{ count: 0 }] : await db.select({ count: count() }).from(tenants).catch(() => [{ count: 0 }]);
  const activeConnectionsResult = demoMode
    ? [{ count: 0 }]
    : await db
        .select({ count: count() })
        .from(waAccounts)
        .where(eq(waAccounts.isConnected, true))
        .catch(() => [{ count: 0 }]);

  const totalMessagesResult = demoMode ? [{ count: 0 }] : await db.select({ count: count() }).from(messages).catch(() => [{ count: 0 }]);
  const missedRevenueResult = demoMode
    ? [{ value: 0 }]
    : await db
        .select({ value: sql<number>`COALESCE(SUM(${conversations.estimatedValueCents}), 0)` })
        .from(conversations)
        .where(eq(conversations.outcome, 'missed'))
        .catch(() => [{ value: 0 }]);
  const recentTenantsLive = demoMode
    ? []
    : await db.select().from(tenants).orderBy(desc(tenants.createdAt)).limit(10).catch(() => []);
  const settings = await db.query.systemSettings.findFirst().catch(() => null);
  const cronKeyState = await cronKeyConfigured().catch(() => ({ configured: false, source: 'none' as const }));
  // Canonical fleet size for the manager's copy — read from the same loader
  // the sync endpoint uses (fs file, embedded snapshot fallback), so the
  // "N jobs" label can never drift from scripts/cron-fleet.json again.
  const fleetSize = (() => {
    try {
      return loadCanonicalFleet().fleet.jobs.length;
    } catch {
      return 0;
    }
  })();

  // Gate #2 — slow days across the whole platform, this week.
  //
  // Same definition the tenant dashboard and the morning brief use
  // (lib/revenue/slow-days.ts): each day of the last complete week against
  // that weekday's own 90-day average, flagged below 60%. Booking counts
  // are grouped per tenant per day in Postgres, so a platform-wide count
  // costs one aggregate query rather than 97 days of raw reservation rows
  // for every tenant. Falls back to 0 like every other metric on this
  // page — the overview should still render if one query fails.
  //
  // Gate #5 — the SAME fetch now feeds a second KPI: "Total Priority
  // Value", the sum of each tenant's top-priority critical slow day. One
  // shared query, two KPIs — no second read of the reservation history,
  // and both degrade to 0 together when the fetch fails (an empty map is
  // "no data", and 0 is the honest number to show).
  const slowDayWindow = computeSlowDayWindow();
  const slowDayAggregates = demoMode
    ? new Map<string, DayAggregate[]>()
    : await fetchSlowDayAggregatesByTenant(slowDayWindow.historyStart, slowDayWindow.weekEnd)
        .catch(() => new Map<string, DayAggregate[]>());

  // Gate #6 — "Platform Total Opportunity": the sum of every tenant's
  // own total opportunity value (missed enquiries + slow days +
  // cancellations + no-shows over the last 30 days).
  //
  // The three new scans (missed enquiries, cancellations, no-shows) run
  // here for the whole platform. The slow-day component is NOT re-read:
  // it comes from the same `slowDayAggregates` the Gate #2/#5 KPIs above
  // already fetched, so one reservation-history fetch still serves all
  // three KPIs. Fetches degrade to empty maps, so the page renders 0 on
  // a transient query failure rather than crashing.
  const now = new Date();
  const opportunityWindowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const opportunityInputsByTenant = demoMode
    ? new Map<string, OpportunityInputs>()
    : await fetchCrossTenantOpportunityInputs(opportunityWindowStart, now).catch(
        () => new Map<string, OpportunityInputs>()
      );

  // Gate #8 — one grouped read for the platform-wide segmentation metric.
  // This page is already behind the Super Admin gate, and the store returns
  // zeroes for missing segments so a sparse platform still renders a stable
  // KPI. A transient read failure should not take down the entire overview.
  const platformSegmentCountsLive = demoMode
    ? emptySegmentCounts()
    : await fetchCrossTenantSegmentCounts().catch(() => emptySegmentCounts());

  // Gate #10 — platform-wide VIP walk-in alerts raised so far today. Staff
  // facing only; degrades to 0 so a transient read failure never takes down
  // the Super Admin overview.
  const vipAlertsTodayLive = demoMode ? 0 : await countVipAlertsToday().catch(() => 0);

  // Gate #14 — reputation engine, platform-wide: how many competitors are
  // being tracked across all tenants, and how many rating-drop alerts the
  // daily 7am sweep raised this week. Same degrade-to-0 contract as above.
  const ratingDropAlertsThisWeekLive = demoMode ? 0 : await countRatingDropAlertsThisWeek().catch(() => 0);

  // Gates #15-#18 — market intelligence engine, platform-wide: competitors
  // tracked across all tenants, how many of those the rating sweep can poll
  // (they have a Google place id), opportunities detected by the daily sweep,
  // and menu/promotion alerts raised this week. Same degrade-to-0 contract.
  const competitorsTrackedLive = demoMode ? 0 : await countAllMarketCompetitors().catch(() => 0);
  const ratingMonitoredCompetitorsLive = demoMode ? 0 : await countCompetitorsWithPlaceId().catch(() => 0);
  const marketOpportunitiesLive = demoMode ? 0 : await countAllOpportunities().catch(() => 0);
  const marketAlertsThisWeekLive = demoMode ? 0 : await countMarketAlertsThisWeek().catch(() => 0);

  const totalTenants = demoMode ? DEMO_PLATFORM_KPIS.totalTenants : totalTenantsResult[0]?.count ?? 0;
  const activeConnections = demoMode ? DEMO_PLATFORM_KPIS.activeSockets : activeConnectionsResult[0]?.count ?? 0;
  const totalMessages = demoMode ? DEMO_PLATFORM_KPIS.messagesProcessed : totalMessagesResult[0]?.count ?? 0;
  const aggregateMissedRevenueCents = demoMode
    ? DEMO_PLATFORM_KPIS.missedRevenueCents
    : Number(missedRevenueResult[0]?.value ?? 0);
  const aggregateMissedRevenue = aggregateMissedRevenueCents / 100;
  const isMasterAiOn = settings?.masterAiSwitch ?? true;

  // Demo branch for the computed engines (slow days, opportunity,
  // segmentation, reputation, market intelligence): the seed dataset
  // replaces every aggregate wholesale. Live branch: unchanged queries.
  const slowDaysDetected = demoMode
    ? DEMO_PLATFORM_KPIS.slowDaysDetected
    : totalSlowDays(
        Array.from(slowDayAggregates.values()).map((aggregates) => analyzeDayAggregates(aggregates, { now: new Date() }))
      );
  const totalPriorityValueCents = demoMode
    ? DEMO_PLATFORM_KPIS.totalPriorityValueCents
    : totalTopPriorityValueCents(slowDayAggregates, { now: new Date() });

  const platformOpportunity = demoMode
    ? { total_opportunity_cents: DEMO_PLATFORM_KPIS.platformOpportunityCents }
    : calculatePlatformOpportunity(opportunityInputsByTenant, {
        now,
        slowDayAggregatesByTenant: slowDayAggregates,
      });

  const platformSegmentCounts = demoMode
    ? {
        vip: DEMO_PLATFORM_KPIS.segmentVip,
        regular: DEMO_PLATFORM_KPIS.segmentRegular,
        at_risk: DEMO_PLATFORM_KPIS.segmentAtRisk,
        dormant: DEMO_PLATFORM_KPIS.segmentDormant,
        new: DEMO_PLATFORM_KPIS.segmentNew,
      }
    : platformSegmentCountsLive;

  const vipAlertsToday = demoMode ? DEMO_PLATFORM_KPIS.vipAlertsToday : vipAlertsTodayLive;
  const ratingDropAlertsThisWeek = demoMode
    ? DEMO_PLATFORM_KPIS.ratingDropAlertsThisWeek
    : ratingDropAlertsThisWeekLive;
  const competitorsTracked = demoMode ? DEMO_PLATFORM_KPIS.competitorsTracked : competitorsTrackedLive;
  const ratingMonitoredCompetitors = demoMode
    ? DEMO_PLATFORM_KPIS.ratingMonitoredCompetitors
    : ratingMonitoredCompetitorsLive;
  const marketOpportunities = demoMode ? DEMO_PLATFORM_KPIS.marketOpportunities : marketOpportunitiesLive;
  const marketAlertsThisWeek = demoMode ? DEMO_PLATFORM_KPIS.marketAlertsThisWeek : marketAlertsThisWeekLive;

  // Recent tenants table: seed dataset (SA restaurants) or live rows.
  const recentTenants = demoMode
    ? DEMO_TENANTS.map((t) => ({
        id: t.slug,
        name: t.name,
        slug: t.slug,
        aiEnabled: t.aiEnabled,
        manualMode: t.manualMode,
        createdAt: new Date(t.joinedDate),
      }))
    : recentTenantsLive;

  // MRR display: live uses the $49 pricing copy; demo shows the seed
  // dataset's ZAR economics (R699/tenant, 24 tenants).
  const estMrr = demoMode ? DEMO_PLATFORM_KPIS.mrrZar : totalTenants * 49;
  const mrrDisplay = demoMode ? `R${estMrr.toLocaleString()}` : `$${estMrr.toLocaleString()}`;
  const mrrTrend = demoMode ? 'R699/mo per tenant' : '$49/mo per tenant';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 selection:bg-zinc-800">
      {/* GATE 2 — Demo Mode banner (only the Super Admin ever gets
          active=true from the server; the cookie alone fails closed). */}
      <DemoModeBar active={demoMode} />
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
              <Link
               href="/admin/analytics"
               className="px-3.5 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 rounded-md hover:bg-zinc-800 text-zinc-200 transition-colors"
              >
               Platform Analytics
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

        {/* Cron Fleet Manager — UI-driven cron lifecycle (no Vercel env needed) */}
        <CronFleetManager initialKeyConfigured={cronKeyState.configured} fleetSize={fleetSize} />

        {/* Demo Mode — busy-restaurant seed for screenshots/videos */}
        {!demoMode && <DemoControls initialActive={Boolean(settings?.demoSeedActive)} />}
        {demoMode && (
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-5 text-sm text-amber-300">
            <span className="font-semibold">Demo Mode active.</span> Every business metric and tenant row on this
            page renders from the deterministic seed dataset (lib/demo/seed-data.ts) — the live database is neither
            read for metrics nor written to. Infrastructure controls (kill-switch, cron fleet) stay live so the page
            remains operable. The row-seeding Demo Controls are hidden in this mode to keep the two demo tools
            unambiguous.
          </div>
        )}

        {/* KPI Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-10">
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
            value={mrrDisplay}
            icon={DollarSign}
            trend={mrrTrend}
          />
          <StatCard
            title="Missed Revenue Detected"
            value={`R${aggregateMissedRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            icon={DollarSign}
            trend="Across all tenants"
          />
          <StatCard
            title="Slow Days Detected"
            value={slowDaysDetected.toString()}
            icon={CalendarX}
            trend="Under 60% of normal, this week"
          />
          <StatCard
            title="Total Priority Value"
            value={`R${(totalPriorityValueCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            icon={Target}
            trend="Sum of each tenant's top critical action"
          />
          <StatCard
            title="Platform Total Opportunity"
            value={`R${(platformOpportunity.total_opportunity_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            icon={TrendingUp}
            trend="Sum of all tenants' potential recovery"
          />
          <StatCard
            title="Platform Segmentation"
            value={`VIP ${platformSegmentCounts.vip} · Regular ${platformSegmentCounts.regular} · At-risk ${platformSegmentCounts.at_risk} · Dormant ${platformSegmentCounts.dormant} · New ${platformSegmentCounts.new}`}
            icon={Users}
            trend="Customer profiles across all tenants"
          />
          <StatCard
            title="VIP Alerts Today"
            value={vipAlertsToday.toString()}
            icon={Star}
            trend="Staff-facing walk-in alerts, all tenants"
          />
          <StatCard
            title="Competitors Tracked"
            value={competitorsTracked.toString()}
            icon={Swords}
            trend={`${ratingMonitoredCompetitors} of them rating-monitored`}
          />
          <StatCard
            title="Rating Drop Alerts"
            value={ratingDropAlertsThisWeek.toString()}
            icon={TrendingDown}
            trend="0.2★+ drops flagged this week"
          />
          <StatCard
            title="Market Opportunities"
            value={marketOpportunities.toString()}
            icon={Lightbulb}
            trend="Gaps detected in tracked markets"
          />
          <StatCard
            title="Competitor Alerts"
            value={marketAlertsThisWeek.toString()}
            icon={BellRing}
            trend="Menu + promotion changes, this week"
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
