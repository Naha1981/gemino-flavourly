import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, CheckCircle2, CircleAlert, Radar, Sparkles, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { googleReviews, reservations, revenueEvents } from '@/lib/db/schema';
import { getOpportunities } from '@/lib/market/opportunity-store';
import { listCompetitors } from '@/lib/market/competitor-store';
import { isDemoModeActive } from '@/lib/demo/demo-mode';
import { liveRowsOnly } from '@/lib/demo/query-scope';

export const dynamic = 'force-dynamic';

function rand(cents: number | null | undefined): string {
  return 'R' + ((Number(cents) || 0) / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 });
}

function evidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'Strong evidence';
  if (confidence >= 0.6) return 'Evidence';
  return 'Needs verification';
}

export default async function RevenueIntelligencePage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const demoMode = await isDemoModeActive();
  const liveScope = { includeDemoRows: demoMode };
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [[revenue], [bookingCount], [reviewSummary], competitors, opportunities] = await Promise.all([
    db.select({ total: sql<number>`COALESCE(SUM(${revenueEvents.realizedCents}), 0)` }).from(revenueEvents).where(and(eq(revenueEvents.tenantId, tenant.id), gte(revenueEvents.occurredAt, start), liveRowsOnly(revenueEvents.id, liveScope))).catch(() => [{ total: 0 }]),
    db.select({ total: count() }).from(reservations).where(and(eq(reservations.tenantId, tenant.id), gte(reservations.date, start), liveRowsOnly(reservations.id, liveScope))).catch(() => [{ total: 0 }]),
    db.select({ average: sql<number | null>`AVG(${googleReviews.rating})`, total: count() }).from(googleReviews).where(and(eq(googleReviews.tenantId, tenant.id), liveRowsOnly(googleReviews.id, liveScope))).catch(() => [{ average: null, total: 0 }]),
    listCompetitors(tenant.id).catch(() => []),
    getOpportunities(tenant.id).catch(() => []),
  ]);

  const open = opportunities.filter((item) => !item.addressed);
  const top = [...open].sort((a, b) => Number(b.confidence) - Number(a.confidence)).slice(0, 5);

  return (
    <div className="max-w-7xl space-y-6">
      <div className="rounded-[28px] border border-app-border bg-app-surface-0 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-app-border bg-app-surface-1 px-3 py-1.5 text-xs font-semibold text-app-muted dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"><Radar className="h-3.5 w-3.5 text-app-secondary dark:text-emerald-400" />Restaurant Revenue Intelligence</div>
            <h1 className="headline-lg mt-5 text-app-fg dark:text-zinc-50">See where revenue is leaking. Then prove what changed.</h1>
            <p className="body-md mt-3 max-w-2xl text-app-muted dark:text-zinc-400">Flavourly combines verified revenue, bookings, reviews and market intelligence into one operating loop: discover → diagnose → activate → measure.</p>
          </div>
          <Link href="/audit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-stitch-gold px-4 py-3 text-sm font-semibold text-zinc-950 hover:opacity-90 dark:bg-emerald-500 dark:hover:bg-emerald-400">Run a prospect audit <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi title="Verified revenue · 30d" value={rand(revenue?.total)} detail="Recorded revenue events only" />
        <Kpi title="Bookings · 30d" value={String(bookingCount?.total ?? 0)} detail="Reservation records" />
        <Kpi title="Tracked competitors" value={String(competitors.length)} detail="Current market watchlist" />
        <Kpi title="Review health" value={reviewSummary?.average ? String(Number(reviewSummary.average).toFixed(1)) + '★' : '—'} detail={String(reviewSummary?.total ?? 0) + ' reviews on record'} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="glass-card p-6">
          <div className="flex items-center justify-between gap-4"><div><h2 className="label-md text-app-fg dark:text-zinc-50">Opportunity queue</h2><p className="label-sm mt-1 text-app-faint dark:text-zinc-500">{open.length} open market opportunities</p></div><Link href="/dashboard/market/opportunities" className="label-sm inline-flex items-center gap-1 text-app-secondary hover:underline dark:text-emerald-400">Open market intelligence <ArrowRight className="h-3 w-3" /></Link></div>
          {top.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-app-border p-6 text-sm text-app-muted dark:border-zinc-800 dark:text-zinc-400">No open market opportunities are currently recorded. Run competitor discovery and market analysis to populate this queue.</div>
          ) : (
            <div className="mt-5 space-y-3">
              {top.map((item) => {
                const confidence = Number(item.confidence);
                return (
                  <article key={item.id} className="rounded-2xl border border-app-border bg-app-surface-1 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-app-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-app-muted dark:border-zinc-700 dark:text-zinc-400">{item.opportunityType.replace(/_/g, ' ')}</span><span className="text-[10px] font-semibold text-app-secondary dark:text-emerald-400">{evidenceLabel(confidence)}</span></div><h3 className="mt-2 text-sm font-semibold text-app-fg dark:text-zinc-100">{item.title}</h3><p className="mt-1 text-xs leading-5 text-app-muted dark:text-zinc-400">{item.description}</p></div>
                      <div className="text-right"><p className="text-[10px] uppercase tracking-[0.12em] text-app-faint">Confidence</p><p className="text-lg font-semibold text-app-fg dark:text-zinc-100">{confidence.toFixed(2)}</p></div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="inline-flex items-center gap-1 rounded-full bg-app-secondary-container px-2 py-1 text-app-on-secondary-container dark:bg-emerald-950 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" /> Evidence-linked</span><Link href="/dashboard/market/opportunities" className="ml-auto text-app-secondary hover:underline dark:text-emerald-400">Investigate</Link></div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="glass-card p-6"><div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-app-secondary dark:text-emerald-400" /><h2 className="label-md text-app-fg dark:text-zinc-50">Operating loop</h2></div><div className="mt-5 space-y-3">
            {[['Discover', 'Market and customer signals'], ['Diagnose', 'Evidence-backed leakage'], ['Activate', 'Approved commercial action'], ['Measure', 'Lead, booking and revenue'], ['Learn', 'What actually changed']].map(([title, text], index) => <div key={title} className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-app-surface-2 text-xs font-semibold text-app-fg dark:bg-zinc-800 dark:text-zinc-200">{index + 1}</span><div><p className="text-sm font-semibold text-app-fg dark:text-zinc-100">{title}</p><p className="text-xs leading-5 text-app-muted dark:text-zinc-400">{text}</p></div></div>)}
          </div></div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-amber-950/20"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" /><div><p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Evidence boundary</p><p className="mt-1 text-xs leading-5 text-amber-900/75 dark:text-amber-200/75">A market opportunity or AI recommendation is not revenue. Flavourly records verified revenue separately and only attributes commercial impact when a traceable basis exists.</p></div></div></div>
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SignalCard icon={<Sparkles className="h-4 w-4" />} title="Menu conversion" text="Move from market gaps into menu structure, copy, imagery and offers." href="/dashboard/market/competitors" />
        <SignalCard icon={<Radar className="h-4 w-4" />} title="Review intelligence" text="Find repeated customer complaints and turn them into explicit investigation points." href="/dashboard/reputation" />
        <SignalCard icon={<TrendingUp className="h-4 w-4" />} title="Revenue proof" text="Connect campaigns, bookings and revenue so the owner sees commercial outcomes." href="/dashboard/analytics" />
      </div>
    </div>
  );
}

function Kpi({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <div className="glass-card p-5"><p className="label-sm uppercase tracking-[0.12em] text-app-faint dark:text-zinc-500">{title}</p><p className="mt-2 display-lg !text-[32px] !leading-[38px] text-app-fg dark:text-zinc-50">{value}</p><p className="mt-2 label-sm text-app-muted dark:text-zinc-400">{detail}</p></div>;
}

function SignalCard({ icon, title, text, href }: { icon: ReactNode; title: string; text: string; href: string }) {
  return <Link href={href} className="glass-card group p-5 transition-transform hover:-translate-y-0.5"><div className="flex items-center gap-2 text-app-secondary dark:text-emerald-400">{icon}<span className="label-md">{title}</span></div><p className="mt-3 text-sm leading-6 text-app-muted dark:text-zinc-400">{text}</p><span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-app-fg dark:text-zinc-200">Open <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span></Link>;
}
