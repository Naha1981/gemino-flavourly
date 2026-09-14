import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { ArrowRight, BarChart3, CalendarDays, MessageCircle, Sparkles } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { marketingCampaigns, marketOpportunities, waAccounts } from '@/lib/db/schema';
import { GrowthLoopCard } from '../growth-loop-card';

export const dynamic = 'force-dynamic';

export default async function GrowthPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return null;

  const [opportunity] = await db.select({
    id: marketOpportunities.id,
    title: marketOpportunities.title,
    description: marketOpportunities.description,
    confidence: marketOpportunities.confidence,
    opportunityType: marketOpportunities.opportunityType,
  }).from(marketOpportunities)
    .where(and(eq(marketOpportunities.tenantId, tenant.id), eq(marketOpportunities.addressed, false)))
    .orderBy(desc(marketOpportunities.confidence), desc(marketOpportunities.detectedAt))
    .limit(1)
    .catch(() => []);

  const [campaigns, wa] = await Promise.all([
    db.select().from(marketingCampaigns).where(eq(marketingCampaigns.tenantId, tenant.id)).orderBy(desc(marketingCampaigns.createdAt)).limit(5).catch(() => []),
    db.select({ isConnected: waAccounts.isConnected }).from(waAccounts).where(eq(waAccounts.tenantId, tenant.id)).limit(1).catch(() => []),
  ]);

  const connectedWhatsApp = Boolean(wa[0]?.isConnected);

  return (
    <div className="max-w-6xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label-sm uppercase tracking-[0.18em] text-app-faint">Restaurant growth</p>
          <h1 className="headline-lg mt-2 text-app-fg dark:text-zinc-50">Turn opportunities into customers.</h1>
          <p className="body-md mt-2 max-w-2xl text-app-muted dark:text-zinc-400">Flavourly finds the opportunity. Your content engine creates the campaign. WhatsApp and social distribution turn attention into bookings.</p>
        </div>
        <Link href="/dashboard/marketing/campaigns" className="inline-flex items-center justify-center gap-2 rounded-full bg-app-fg px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-black">Open campaigns <ArrowRight className="h-4 w-4" /></Link>
      </header>

      <GrowthLoopCard opportunity={opportunity ?? null} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="glass-card p-6">
          <MessageCircle className="h-5 w-5 text-app-secondary" />
          <p className="label-sm mt-5 uppercase tracking-wide text-app-faint">WhatsApp</p>
          <p className="mt-1 text-xl font-semibold text-app-fg dark:text-zinc-50">{connectedWhatsApp ? 'Connected' : 'Connect it'}</p>
          <p className="mt-2 text-sm text-app-muted">Your guest conversion layer.</p>
          <Link href="/dashboard/whatsapp" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-app-secondary">Manage <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="glass-card p-6">
          <CalendarDays className="h-5 w-5 text-app-secondary" />
          <p className="label-sm mt-5 uppercase tracking-wide text-app-faint">Campaigns</p>
          <p className="mt-1 text-xl font-semibold text-app-fg dark:text-zinc-50">{campaigns.length} recent</p>
          <p className="mt-2 text-sm text-app-muted">Draft, improve, launch and learn.</p>
          <Link href="/dashboard/marketing/calendar" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-app-secondary">Calendar <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="glass-card p-6">
          <BarChart3 className="h-5 w-5 text-app-secondary" />
          <p className="label-sm mt-5 uppercase tracking-wide text-app-faint">Revenue proof</p>
          <p className="mt-1 text-xl font-semibold text-app-fg dark:text-zinc-50">Bookings → revenue</p>
          <p className="mt-2 text-sm text-app-muted">Measure business outcomes, not vanity metrics.</p>
          <Link href="/dashboard/analytics" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-app-secondary">View analytics <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </div>

      <section className="glass-card p-6 sm:p-7">
        <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-stitch-gold" /><h2 className="label-md text-app-fg dark:text-zinc-50">Recent campaign activity</h2></div>
        {campaigns.length === 0 ? (
          <p className="body-md mt-5 text-app-muted">No campaigns yet. Start from a detected opportunity or create your first campaign.</p>
        ) : (
          <div className="mt-5 divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {campaigns.map((c) => (
              <div key={c.id} className="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-sm font-semibold text-app-fg dark:text-zinc-50">{c.name}</p><p className="mt-1 text-xs text-app-muted">{c.offer || c.type} · {c.status}</p></div>
                <Link href="/dashboard/marketing/campaigns" className="inline-flex items-center gap-1 text-xs font-semibold text-app-secondary">Open <ArrowRight className="h-3 w-3" /></Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
