import { FileText, CalendarDays, Rocket, Sparkles, Megaphone } from 'lucide-react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateTenant } from '@/lib/tenant';
import { getBriefHistory, getLatestBrief } from '@/lib/marketing/brief-store';
import { listMarketingCampaigns } from '@/lib/marketing/campaign-store';
import { listMarketingEvents } from '@/lib/marketing/event-store';
import { GenerateBriefButton } from './generate-button';

export const dynamic = 'force-dynamic';

export default async function MarketingPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const [latest, history, campaigns, events] = await Promise.all([
    getLatestBrief(tenant.id),
    getBriefHistory(tenant.id),
    listMarketingCampaigns(tenant.id).catch(() => []),
    listMarketingEvents(tenant.id).catch(() => []),
  ]);

  const brief = latest?.brief as
    | { summary?: string; ideas?: Array<{ topic: string; audience: string; message: string; cta: string; visual: string }> }
    | undefined;

  const liveCampaign =
    campaigns.find((c) => c.status === 'sent') ?? campaigns.find((c) => c.status === 'scheduled') ?? campaigns[0] ?? null;

  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const thisWeek = events
    .filter((e) => {
      const start = new Date(e.startsAt);
      return start >= new Date(now.toDateString()) && start <= weekEnd;
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, 5);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-3 border-b border-app-border pb-4 dark:border-zinc-800">
        <FileText className="h-5 w-5 text-app-secondary dark:text-emerald-400" />
        <div>
          <h1 className="headline-md text-app-fg dark:text-zinc-50">Marketing Automation</h1>
          <p className="label-sm text-app-muted dark:text-zinc-400">Briefs, campaigns and this week&apos;s plan.</p>
        </div>
        <span className="ml-auto"><GenerateBriefButton /></span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Campaign highlight */}
        <div className="glass-card p-6 lg:col-span-2">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-app-secondary dark:text-emerald-400" />
            <h2 className="label-md text-app-fg dark:text-zinc-50">Campaign Spotlight</h2>
          </div>
          {liveCampaign ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <h3 className="headline-md text-app-fg dark:text-zinc-100">{liveCampaign.name}</h3>
                <span
                  className={`label-sm rounded-full px-2.5 py-0.5 ${
                    liveCampaign.status === 'sent'
                      ? 'bg-app-secondary-container text-app-on-secondary-container dark:bg-emerald-950 dark:text-emerald-300'
                      : liveCampaign.status === 'scheduled'
                        ? 'bg-app-tertiary-container/40 text-app-tertiary dark:bg-blue-950 dark:text-blue-300'
                        : 'bg-app-surface-3 text-app-muted dark:bg-zinc-800 dark:text-zinc-300'
                  }`}
                >
                  {liveCampaign.status === 'sent' ? 'launched' : liveCampaign.status}
                </span>
              </div>
              <p className="body-md mt-2 text-app-muted dark:text-zinc-400">{liveCampaign.message}</p>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-app-surface-1 p-3 text-center dark:bg-zinc-900">
                  <p className="text-lg font-semibold text-app-fg dark:text-zinc-50">
                    +{Math.max(0, Math.round((liveCampaign.estimatedReach ?? 0) / 60))}
                  </p>
                  <span className="label-sm text-app-faint dark:text-zinc-500">est. tables</span>
                </div>
                <div className="rounded-xl bg-app-surface-1 p-3 text-center dark:bg-zinc-900">
                  <p className="text-lg font-semibold text-app-fg dark:text-zinc-50">{liveCampaign.estimatedReach ?? 0}</p>
                  <span className="label-sm text-app-faint dark:text-zinc-500">reach</span>
                </div>
                <div className="rounded-xl bg-app-surface-1 p-3 text-center dark:bg-zinc-900">
                  <p className="text-lg font-semibold text-app-fg dark:text-zinc-50">{liveCampaign.sentCount ?? 0}</p>
                  <span className="label-sm text-app-faint dark:text-zinc-500">sent</span>
                </div>
                <div className="rounded-xl bg-app-surface-1 p-3 text-center dark:bg-zinc-900">
                  <p className="text-lg font-semibold text-app-fg dark:text-zinc-50">
                    R{((liveCampaign.estimatedRevenueCents ?? 0) / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}
                  </p>
                  <span className="label-sm text-app-faint dark:text-zinc-500">est. revenue</span>
                </div>
              </div>
            </>
          ) : (
            <p className="body-md mt-4 text-app-muted dark:text-zinc-400">
              No campaigns yet — generate a plan below or browse templates.
            </p>
          )}
          <div className="mt-5 flex gap-2">
            <Link href="/dashboard/marketing/campaigns" className="label-md rounded-lg bg-app-secondary px-4 py-2 font-semibold text-white hover:opacity-90 dark:bg-emerald-600">
              All Campaigns
            </Link>
            <Link href="/dashboard/marketing/calendar" className="label-md rounded-lg border border-app-border px-4 py-2 font-semibold text-app-fg hover:bg-app-surface-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              Calendar
            </Link>
          </div>
        </div>

        {/* AI Campaign Generator */}
        <div className="glass-card !bg-app-secondary-container/60 p-6 dark:!bg-emerald-950/40">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-app-on-secondary-container dark:text-emerald-300" />
            <h2 className="label-md text-app-on-secondary-container dark:text-emerald-200">AI Campaign Generator</h2>
          </div>
          <textarea
            defaultValue="A winter supper-club night for regulars, with a live acoustic set and a set menu."
            rows={4}
            aria-label="Campaign idea"
            className="body-md mt-4 w-full rounded-xl border border-app-border bg-app-surface-0 p-3 text-app-fg focus:border-stitch-gold focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-emerald-500"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="label-sm text-app-on-secondary-container/80 dark:text-emerald-300/80">
              Uses today&apos;s brief + your menu
            </span>
            <GenerateBriefButton />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Daily briefs */}
        <div className="lg:col-span-2">
          <h2 className="label-md mb-3 text-app-fg dark:text-zinc-50">Daily Briefs</h2>
          {!brief ? (
            <p className="rounded-2xl border border-dashed border-app-border p-8 text-sm text-app-muted dark:border-zinc-800 dark:text-zinc-400">
              No brief generated yet. The daily brief will appear here at 7am.
            </p>
          ) : (
            <div className="space-y-4">
              <p className="body-md text-app-fg dark:text-zinc-300">{brief.summary}</p>
              <div className="grid gap-3 lg:grid-cols-2">
                {(brief.ideas ?? []).map((idea) => (
                  <article key={idea.topic} className="glass-card p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="label-md text-app-fg dark:text-zinc-100">{idea.topic}</h3>
                      <Link
                        href="/dashboard/marketing/campaigns"
                        className="label-sm rounded-lg border border-app-border px-2.5 py-1 text-app-muted hover:bg-app-surface-2 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        Edit
                      </Link>
                    </div>
                    <p className="body-md mt-2 text-app-muted dark:text-zinc-300">{idea.message}</p>
                    <p className="label-sm mt-3 text-app-faint dark:text-zinc-500">Audience: {idea.audience}</p>
                    <p className="label-sm mt-1 text-app-secondary dark:text-emerald-300">CTA: {idea.cta}</p>
                    <p className="label-sm mt-1 text-app-faint dark:text-zinc-500">Visual: {idea.visual}</p>
                  </article>
                ))}
              </div>
              <div className="glass-card p-4">
                <h3 className="label-md mb-2 text-app-fg dark:text-zinc-200">Brief history</h3>
                <div className="space-y-2">
                  {history.slice(0, 8).map((row) => (
                    <div key={row.id} className="flex justify-between border-b border-app-border/70 py-2 text-xs text-app-muted last:border-0 dark:border-zinc-800 dark:text-zinc-400">
                      <span>{new Date(row.generatedAt).toISOString().slice(0, 10)}</span>
                      <span>{(row.brief as { ideas?: unknown[] }).ideas?.length ?? 0} ideas</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* This week rail */}
        <div>
          <h2 className="label-md mb-3 flex items-center gap-2 text-app-fg dark:text-zinc-50">
            <CalendarDays className="h-4 w-4 text-app-secondary dark:text-emerald-400" /> This Week
          </h2>
          {thisWeek.length === 0 ? (
            <div className="glass-card p-6">
              <p className="body-md text-app-muted dark:text-zinc-400">Nothing scheduled this week yet.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {thisWeek.map((e) => (
                <li key={e.id} className="glass-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="label-md text-app-fg dark:text-zinc-100">{e.name}</span>
                    <span className="label-sm rounded-full bg-app-surface-3 px-2 py-0.5 text-app-muted dark:bg-zinc-800 dark:text-zinc-300">
                      {new Date(e.startsAt).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <p className="label-sm mt-1 text-app-faint dark:text-zinc-500">
                    {new Date(e.startsAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                    {' – '}
                    {new Date(e.endsAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                    {e.location ? ` · ${e.location}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/dashboard/marketing/events"
            className="label-md mt-4 inline-flex items-center gap-2 rounded-xl border border-app-border px-4 py-2 font-semibold text-app-fg hover:bg-app-surface-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Rocket className="h-4 w-4 text-app-secondary dark:text-emerald-400" /> Plan an Event
          </Link>
        </div>
      </div>
    </div>
  );
}
