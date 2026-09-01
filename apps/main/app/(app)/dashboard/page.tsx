import { auth, clerkClient } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import {
  waAccounts,
  conversations,
  messages,
  revenueEvents,
  reservations,
  googleReviews,
  vipAlerts,
  marketingCampaigns,
} from '@/lib/db/schema';
import { eq, count, sql, and, gte, desc } from 'drizzle-orm';
import { Activity, MessageSquare, Users, QrCode, AlertTriangle, CheckSquare, ArrowUpRight, ArrowDownRight, Star, Sparkles, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { countPendingApprovals } from '@/lib/operations/approval-request-store';
import { isDemoModeActive } from '@/lib/demo/demo-mode';
import { liveRowsOnly } from '@/lib/demo/query-scope';
import {
  aiBookingsCard,
  revenueWowBadge,
  revenueChartHasData,
  EMPTY_REVENUE_CHART_MESSAGE,
  unansweredBadge,
  sampleChipLabel,
} from '@/lib/dashboard/kpi';

export const dynamic = 'force-dynamic';

export default async function DashboardOverview() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  // getOrCreateTenant() no longer throws — it returns null on failure —
  // but wrapping the call site too means a fallback UI renders even if
  // something upstream (e.g. a Clerk API outage) throws in a way that
  // slips past that function's own guards.
  let tenant;
  try {
    tenant = await getOrCreateTenant();
  } catch (err) {
    console.error('[DashboardOverview] getOrCreateTenant threw unexpectedly:', err);
    tenant = null;
  }

  if (!tenant) {
    return <SetupNeededFallback />;
  }

  const [waAccount] = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.tenantId, tenant.id))
    .limit(1)
    .catch(() => [null]);

  const activeConversations = await db
    .select({ count: count() })
    .from(conversations)
    .where(eq(conversations.tenantId, tenant.id))
    .catch(() => [{ count: 0 }]);

  const totalMessages = await db
    .select({ count: count() })
    .from(messages)
    .where(eq(messages.tenantId, tenant.id))
    .catch(() => [{ count: 0 }]);

  const client = typeof clerkClient === 'function' ? await (clerkClient as any)() : clerkClient;
  const user = await client.users.getUser(userId).catch(() => ({ firstName: 'Owner' }));

  // One-time onboarding redirect: a tenant that has never successfully
  // connected WhatsApp is sent straight to the QR scanner instead of an
  // empty metrics page. Uses waAccount.lastConnectedAt (set once, the
  // first time a connection succeeds, and never cleared) rather than
  // isConnected (the live/current state) or a "created in the last N
  // minutes" time window:
  //   - lastConnectedAt correctly catches true first-timers no matter
  //     how long they take to get through signup/onboarding — a 2-minute
  //     window missed anyone who took longer, which is exactly what was
  //     reported (real account, no onboarding screen, well past 2 min).
  //   - It does NOT trap a returning owner who later disconnects for any
  //     reason (Render restart, manual logout, etc.) — that owner has a
  //     non-null lastConnectedAt from their first successful connection,
  //     so they keep seeing their normal dashboard, not a forced redirect
  //     loop to the QR page every time they open the app.
  const neverConnected = !waAccount?.lastConnectedAt;
  if (neverConnected) {
    redirect('/dashboard/whatsapp');
  }

  // Engine 6 approval workflow: surface a pending-approvals banner so the
  // owner knows a YELLOW/RED AI reply is waiting for their sign-off.
  const pendingApprovals = await countPendingApprovals(tenant.id).catch(() => 0);

  // ── UI-3R / F2 — LIVE views read ONLY real rows ──
  // Demo seed rows carry the deadbeef- id prefix (including the demo
  // "platform tenants" like Marble). They are excluded from every live
  // query below and appear only with Demo Mode ON (SAMPLE chips + banner).
  const demoMode = await isDemoModeActive();
  const liveScope = { includeDemoRows: demoMode };

  // ── Executive bento reads (guarded; empty states render, never crash) ──
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeekAgo = new Date(startOfToday.getTime() - 7 * 24 * 3600 * 1000);
  const startOfYesterdayWeekAgo = new Date(startOfToday.getTime() - 8 * 24 * 3600 * 1000);

  const [revenueToday] = await db
    .select({ value: sql<number>`COALESCE(SUM(${revenueEvents.realizedCents}), 0)` })
    .from(revenueEvents)
    .where(and(eq(revenueEvents.tenantId, tenant.id), gte(revenueEvents.occurredAt, startOfToday), liveRowsOnly(revenueEvents.id, liveScope)))
    .catch(() => [{ value: 0 }]);
  const [revenueThisWeek] = await db
    .select({ value: sql<number>`COALESCE(SUM(${revenueEvents.realizedCents}), 0)` })
    .from(revenueEvents)
    .where(and(eq(revenueEvents.tenantId, tenant.id), gte(revenueEvents.occurredAt, startOfWeekAgo), liveRowsOnly(revenueEvents.id, liveScope)))
    .catch(() => [{ value: 0 }]);
  const [revenueLastWeek] = await db
    .select({ value: sql<number>`COALESCE(SUM(${revenueEvents.realizedCents}), 0)` })
    .from(revenueEvents)
    .where(
      and(
        eq(revenueEvents.tenantId, tenant.id),
        gte(revenueEvents.occurredAt, startOfYesterdayWeekAgo),
        sql`${revenueEvents.occurredAt} < ${startOfWeekAgo}`,
        liveRowsOnly(revenueEvents.id, liveScope)
      )
    )
    .catch(() => [{ value: 0 }]);

  // UI-3R / F1 (S5) — the week-on-week badge shows a real percentage or
  // nothing at all. A bare arrow with no number is a placeholder, not a KPI.
  const wowBadge = revenueWowBadge(revenueThisWeek?.value ?? 0, revenueLastWeek?.value ?? 0);

  // UI-3R / F1 (S1) — AI Bookings: the number AND its subtext derive from
  // ONE query (today's reservations). The old pair (all-time converted
  // conversations vs today's reservations) is what produced "AI BOOKINGS 0"
  // next to "4 tables booked today".
  const bookingsTodayRows = await db
    .select({ count: count() })
    .from(reservations)
    .where(and(eq(reservations.tenantId, tenant.id), gte(reservations.date, startOfToday), liveRowsOnly(reservations.id, liveScope)))
    .catch(() => [{ count: 0 }]);
  const bookingsToday = (Array.isArray(bookingsTodayRows) ? bookingsTodayRows : [])[0]?.count ?? 0;
  const aiBookings = aiBookingsCard(bookingsToday);

  const reviews = await db
    .select({ rating: googleReviews.rating, responseSentAt: googleReviews.responseSentAt })
    .from(googleReviews)
    .where(and(eq(googleReviews.tenantId, tenant.id), liveRowsOnly(googleReviews.id, liveScope)))
    .catch(() => [] as { rating: number; responseSentAt: Date | null }[]);
  const avgRating = reviews.length ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length : 0;
  const unanswered = unansweredBadge(reviews.filter((r) => !r.responseSentAt).length);

  const vipsToday = await db
    .select({ customerName: vipAlerts.customerName, totalVisits: vipAlerts.totalVisits, preferences: vipAlerts.preferences })
    .from(vipAlerts)
    .where(and(eq(vipAlerts.tenantId, tenant.id), gte(vipAlerts.sentAt, startOfToday), liveRowsOnly(vipAlerts.id, liveScope)))
    .orderBy(desc(vipAlerts.totalVisits))
    .limit(4)
    .catch(() => [] as { customerName: string | null; totalVisits: number; preferences: unknown }[]);

  // 7-day revenue bars for the forecast strip.
  const bars: { label: string; value: number }[] = [];
  for (let d = 6; d >= 0; d--) {
    const dayStart = new Date(startOfToday.getTime() - d * 24 * 3600 * 1000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const [row] = await db
      .select({ value: sql<number>`COALESCE(SUM(${revenueEvents.realizedCents}), 0)` })
      .from(revenueEvents)
      .where(
        and(
          eq(revenueEvents.tenantId, tenant.id),
          gte(revenueEvents.occurredAt, dayStart),
          sql`${revenueEvents.occurredAt} < ${dayEnd}`,
          liveRowsOnly(revenueEvents.id, liveScope)
        )
      )
      .catch(() => [{ value: 0 }]);
    bars.push({ label: dayStart.toLocaleDateString('en-ZA', { weekday: 'short' }), value: row?.value ?? 0 });
  }
  const barMax = Math.max(...bars.map((b) => b.value), 1);
  // UI-3R / F3 (S3) — an all-zero week renders an honest empty state,
  // never seven bare day labels pretending to be a chart.
  const chartHasData = revenueChartHasData(bars.map((b) => b.value));

  const latestCampaign = await db.query.marketingCampaigns.findFirst({
    where: and(eq(marketingCampaigns.tenantId, tenant.id), eq(marketingCampaigns.status, 'sent')),
    orderBy: desc(marketingCampaigns.launchedAt),
  }).catch(() => null);
  // F2 — a demo-seeded campaign must never headline a live Action Center.
  const liveCampaign = latestCampaign && !latestCampaign.id.startsWith('deadbeef-') ? latestCampaign : null;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="headline-lg text-app-fg dark:text-zinc-50">Welcome back, {user?.firstName || 'Owner'}</h1>
        <p className="body-md mt-1 text-app-muted dark:text-zinc-400">
          Here&apos;s what&apos;s happening with your restaurant today.
        </p>
      </div>

      {!waAccount?.isConnected && (
        <div className="glass-card border-l-4 !border-l-stitch-gold p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="label-md text-stitch-brass dark:text-stitch-gold">Action Required: WhatsApp Not Connected</h3>
              <p className="body-md mt-0.5 text-app-muted dark:text-zinc-400">
                Your WhatsApp number is not connected. Connect it to start answering customer inquiries automatically.
              </p>
            </div>
            <Link
              href="/dashboard/whatsapp"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-stitch-gold px-4 py-2 text-sm font-semibold text-zinc-950 shadow-sm transition-colors hover:opacity-90"
            >
              <QrCode className="h-4 w-4" />
              Connect Now
            </Link>
          </div>
        </div>
      )}

      {pendingApprovals > 0 && (
        <div className="glass-card border-l-4 !border-l-app-tertiary p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="label-md flex items-center gap-2 text-app-tertiary dark:text-blue-300">
                <CheckSquare className="h-4 w-4" />
                {pendingApprovals} message{pendingApprovals === 1 ? '' : 's'} awaiting approval
              </h3>
              <p className="body-md mt-0.5 text-app-muted dark:text-zinc-400">
                An AI reply was held for your sign-off before sending. Review it to keep the conversation moving.
              </p>
            </div>
            <Link
              href="/dashboard/operations/approval-requests"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-app-tertiary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90 dark:bg-blue-600"
            >
              Review Approvals
            </Link>
          </div>
        </div>
      )}

      {/* Executive bento */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* KPI trio */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between">
            <span className="label-sm uppercase tracking-wide text-app-faint dark:text-zinc-500">Verified Revenue Today</span>
            {sampleChipLabel(demoMode) && (
              <span className="label-sm rounded-full border border-stitch-gold/60 bg-stitch-gold/10 px-2 py-0.5 text-stitch-brass dark:text-stitch-gold">{sampleChipLabel(demoMode)}</span>
            )}
          </div>
          <div className="mt-2 flex items-end gap-2">
            <p className="display-lg !text-[34px] !leading-[42px] text-app-fg dark:text-zinc-50">
              R{(revenueToday?.value ?? 0) >= 100000
                ? ((revenueToday?.value ?? 0) / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })
                : ((revenueToday?.value ?? 0) / 100).toFixed(0)}
            </p>
            {wowBadge && (
              <span
                className={`mb-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  wowBadge.direction === 'up'
                    ? 'bg-app-secondary-container text-app-on-secondary-container dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-app-error-container text-app-error dark:bg-red-950 dark:text-red-300'
                }`}
              >
                {wowBadge.direction === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {wowBadge.pct > 0 ? '+' : ''}{wowBadge.pct}% week on week
              </span>
            )}
          </div>
          <p className="label-sm mt-2 text-app-faint dark:text-zinc-500">Realized from verified bookings</p>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between">
            <span className="label-sm uppercase tracking-wide text-app-faint dark:text-zinc-500">AI Bookings</span>
            {sampleChipLabel(demoMode) && (
              <span className="label-sm rounded-full border border-stitch-gold/60 bg-stitch-gold/10 px-2 py-0.5 text-stitch-brass dark:text-stitch-gold">{sampleChipLabel(demoMode)}</span>
            )}
          </div>
          <p className="display-lg !text-[34px] !leading-[42px] mt-2 text-app-fg dark:text-zinc-50">{aiBookings.value}</p>
          <p className="label-sm mt-2 text-app-faint dark:text-zinc-500">{aiBookings.subtext}</p>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between">
            <span className="label-sm uppercase tracking-wide text-app-faint dark:text-zinc-500">Reputation</span>
            {sampleChipLabel(demoMode) && (
              <span className="label-sm rounded-full border border-stitch-gold/60 bg-stitch-gold/10 px-2 py-0.5 text-stitch-brass dark:text-stitch-gold">{sampleChipLabel(demoMode)}</span>
            )}
          </div>
          <div className="mt-2 flex items-end gap-2">
            <p className="display-lg !text-[34px] !leading-[42px] text-app-fg dark:text-zinc-50">
              {avgRating ? avgRating.toFixed(1) : '—'}
              <span className="ml-1 text-lg text-stitch-gold">★</span>
            </p>
          </div>
          {unanswered ? (
            <span className="label-sm mt-2 inline-flex items-center gap-1 rounded-full bg-app-error-container px-2 py-0.5 text-app-error dark:bg-red-950 dark:text-red-300">
              <AlertTriangle className="h-3 w-3" /> {unanswered}
            </span>
          ) : (
            <span className="label-sm mt-2 inline-flex items-center gap-1 rounded-full bg-app-secondary-container px-2 py-0.5 text-app-on-secondary-container dark:bg-emerald-950 dark:text-emerald-300">
              all reviews answered
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* VIPs visiting today */}
        <div className="glass-card p-6 lg:col-span-1">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-stitch-gold" />
            <h2 className="label-md text-app-fg dark:text-zinc-50">VIPs Visiting Today</h2>
          </div>
          {vipsToday.length === 0 ? (
            <p className="body-md mt-4 text-app-muted dark:text-zinc-400">No VIP alerts yet today.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {vipsToday.map((v, i) => (
                <li key={i} className="rounded-xl border border-app-border bg-app-surface-1 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center justify-between">
                    <span className="label-md text-app-fg dark:text-zinc-100">{v.customerName || 'VIP guest'}</span>
                    <span className="label-sm text-stitch-brass dark:text-stitch-gold">{v.totalVisits} visits</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Link
                      href="/dashboard/customers/vip-today"
                      className="label-sm rounded-lg bg-stitch-gold px-3 py-1.5 font-semibold text-zinc-950 hover:opacity-90"
                    >
                      Send Welcome
                    </Link>
                    <Link
                      href="/dashboard/customers/vip-today"
                      className="label-sm rounded-lg border border-app-secondary px-3 py-1.5 font-semibold text-app-secondary hover:bg-app-secondary-container/40 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    >
                      Comp Dessert
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Revenue forecast bars — F3: honest empty state when there is
            nothing to draw (S3: bare day labels, no bars, no message). */}
        <div className="glass-card p-6 lg:col-span-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-app-secondary dark:text-emerald-400" />
            <h2 className="label-md text-app-fg dark:text-zinc-50">Revenue — last 7 days</h2>
            {sampleChipLabel(demoMode) && (
              <span className="label-sm ml-auto rounded-full border border-stitch-gold/60 bg-stitch-gold/10 px-2 py-0.5 text-stitch-brass dark:text-stitch-gold">{sampleChipLabel(demoMode)}</span>
            )}
          </div>
          {chartHasData ? (
            <div className="mt-5 flex h-36 items-end gap-2">
              {bars.map((b, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-md bg-app-secondary/80 dark:bg-emerald-600/80"
                    style={{ height: `${Math.max(4, Math.round((b.value / barMax) * 100))}%` }}
                    title={`R${(b.value / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`}
                  />
                  <span className="label-sm text-app-faint dark:text-zinc-500">{b.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 flex h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-app-border px-4 text-center dark:border-zinc-800">
              <p className="body-md text-app-muted dark:text-zinc-400">{EMPTY_REVENUE_CHART_MESSAGE}</p>
            </div>
          )}
        </div>

        {/* Action center + alert mini-card */}
        <div className="space-y-4">
          <div className="glass-card !bg-app-secondary-container/60 p-6 dark:!bg-emerald-950/40">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-app-on-secondary-container dark:text-emerald-300" />
              <h2 className="label-md text-app-on-secondary-container dark:text-emerald-200">Action Center</h2>
            </div>
            {liveCampaign ? (
              <>
                <p className="body-md mt-3 font-medium text-app-on-secondary-container dark:text-emerald-100">
                  {liveCampaign.name}
                </p>
                <p className="label-sm mt-1 text-app-on-secondary-container/80 dark:text-emerald-300/80">
                  {liveCampaign.offer || 'Live campaign'} · est. R
                  {((liveCampaign.estimatedRevenueCents ?? 0) / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}
                </p>
              </>
            ) : (
              <p className="body-md mt-3 text-app-on-secondary-container/90 dark:text-emerald-200/90">
                No live campaign yet — generate one in Marketing.
              </p>
            )}
            <Link
              href="/dashboard/marketing"
              className="label-md mt-4 inline-flex rounded-lg bg-app-secondary px-4 py-2 font-semibold text-white hover:opacity-90 dark:bg-emerald-600"
            >
              Open Marketing
            </Link>
          </div>

          <div className="glass-card p-5">
            <h3 className="label-md text-app-fg dark:text-zinc-50">Pulse</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-xl bg-app-surface-1 p-3 dark:bg-zinc-900">
                <p className="text-xl font-semibold text-app-fg dark:text-zinc-50">{(Array.isArray(activeConversations) ? activeConversations : [])[0]?.count ?? 0}</p>
                <span className="label-sm text-app-faint dark:text-zinc-500">conversations</span>
              </div>
              <div className="rounded-xl bg-app-surface-1 p-3 dark:bg-zinc-900">
                <p className="text-xl font-semibold text-app-fg dark:text-zinc-50">{(Array.isArray(totalMessages) ? totalMessages : [])[0]?.count ?? 0}</p>
                <span className="label-sm text-app-faint dark:text-zinc-500">messages</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Rendered instead of crashing when the tenant can't be resolved or
 * created — almost always because the Neon schema is behind the code
 * (the migration in /api/migrate hasn't been run yet). Gives whoever is
 * looking at this a concrete next step instead of a bare error digest.
 */
function SetupNeededFallback() {
  return (
    <div className="glass-card mx-auto mt-16 max-w-lg p-6 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-stitch-gold dark:text-amber-400" />
      <h2 className="headline-md mt-4 text-app-fg dark:text-amber-200">We couldn&apos;t set up your workspace</h2>
      <p className="body-md mt-2 text-app-muted dark:text-zinc-400">
        This usually means the database schema is out of date. If you&apos;re the site admin, sign in and open{' '}
        <code className="rounded bg-app-surface-2 px-1.5 py-0.5 text-stitch-brass dark:bg-zinc-900 dark:text-amber-300">/api/migrate</code>{' '}
        once to sync it, then reload this page.
      </p>
      <p className="label-sm mt-4 text-app-faint dark:text-zinc-500">
        If this keeps happening, check the Vercel function logs for the exact error.
      </p>
    </div>
  );
}
