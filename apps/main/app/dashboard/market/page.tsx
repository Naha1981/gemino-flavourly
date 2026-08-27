import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Swords, TrendingUp, AlertTriangle, Lightbulb, Rocket, Star } from 'lucide-react';
import { eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { competitors as competitorsTable, competitorPromotions } from '@/lib/db/schema';
import { getOrCreateTenant } from '@/lib/tenant';
import { listCompetitors, latestSnapshotsByCompetitor } from '@/lib/market/competitor-store';
import { getOpportunities } from '@/lib/market/opportunity-store';

export const dynamic = 'force-dynamic';

/**
 * Market Intelligence overview (Stitch layout). Additive index page: the
 * detailed workstreams keep living at /competitors, /opportunities and
 * /positioning — this page surfaces their signal in one executive view.
 */
export default async function MarketPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const [competitorsList, opportunities, snapshotMap, promoRows] = await Promise.all([
    listCompetitors(tenant.id).catch(() => []),
    getOpportunities(tenant.id).catch(() => []),
    latestSnapshotsByCompetitor(tenant.id).catch(() => new Map()),
    db
      .select({
        id: competitorPromotions.id,
        promotionText: competitorPromotions.promotionText,
        detectedAt: competitorPromotions.detectedAt,
      })
      .from(competitorPromotions)
      .innerJoin(competitorsTable, eq(competitorsTable.id, competitorPromotions.competitorId))
      .where(eq(competitorsTable.tenantId, tenant.id))
      .orderBy(desc(competitorPromotions.detectedAt))
      .limit(5)
      .catch(() => [] as { id: string; promotionText: string; detectedAt: Date }[]),
  ]);
  const competitors = competitorsList; // store list (MarketCompetitorRow[])
  const snapshots = Array.from(snapshotMap.values());

  // Opportunity score: best unaddressed confidence on a 0–100 scale.
  const best = opportunities
    .filter((o) => !o.addressed)
    .reduce((max, o) => Math.max(max, Number(o.confidence) || 0), 0);
  const opportunityScore = Math.round(best * 100);

  const avgRating = competitors.length
    ? competitors.reduce((a, c) => a + Number(c.currentRating || 0), 0) / competitors.length
    : 0;
  const threat = avgRating >= 4.4 ? 'High' : avgRating >= 4.0 ? 'Medium' : 'Low';
  const unmetDemand = opportunities.filter((o) => !o.addressed).length;

  const alerts = [
    ...snapshots.slice(0, 3).map((s) => ({
      id: s.id,
      kind: 'Menu change',
      text: s.menuText ?? 'Competitor updated their menu',
      when: s.snapshotAt,
    })),
    ...promoRows.slice(0, 3).map((p) => ({
      id: p.id,
      kind: 'Promotion',
      text: p.promotionText,
      when: p.detectedAt,
    })),
  ]
    .sort((a, b) => new Date(b.when ?? 0).getTime() - new Date(a.when ?? 0).getTime())
    .slice(0, 5);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="headline-md flex items-center gap-2 text-app-fg dark:text-zinc-50">
            <Swords className="h-5 w-5 text-app-secondary dark:text-emerald-400" />
            Market Intelligence
          </h1>
          <p className="body-md mt-1 text-app-muted dark:text-zinc-400">
            What the neighbourhood is doing — and where you win next.
          </p>
        </div>
        <Link
          href="/dashboard/market/competitors"
          className="label-md inline-flex items-center gap-2 rounded-xl bg-app-secondary px-5 py-2.5 font-semibold text-white shadow-sm hover:opacity-90 dark:bg-emerald-600"
        >
          <Rocket className="h-4 w-4" />
          Run Deep Analysis
        </Link>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="glass-card p-5">
          <span className="label-sm uppercase tracking-wide text-app-faint dark:text-zinc-500">Opportunity Score</span>
          <p className="headline-lg mt-2 text-app-fg dark:text-zinc-50">
            {opportunityScore}
            <span className="text-base text-app-faint dark:text-zinc-500">/100</span>
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-app-surface-2 dark:bg-zinc-800">
            <div className="h-full rounded-full bg-stitch-gold" style={{ width: `${opportunityScore}%` }} />
          </div>
        </div>
        <div className="glass-card p-5">
          <span className="label-sm uppercase tracking-wide text-app-faint dark:text-zinc-500">Competitor Threat</span>
          <p className="headline-lg mt-2 text-app-fg dark:text-zinc-50">{competitors.length ? threat : '—'}</p>
          <p className="label-sm mt-2 text-app-faint dark:text-zinc-500">{competitors.length} tracked nearby</p>
        </div>
        <div className="glass-card p-5">
          <span className="label-sm uppercase tracking-wide text-app-faint dark:text-zinc-500">Market Share</span>
          <p className="headline-lg mt-2 text-app-fg dark:text-zinc-50">
            {competitors.length ? `1/${competitors.length + 1}` : '—'}
          </p>
          <p className="label-sm mt-2 text-app-faint dark:text-zinc-500">of tracked venues</p>
        </div>
        <div className="glass-card p-5">
          <span className="label-sm uppercase tracking-wide text-app-faint dark:text-zinc-500">Unmet Demand</span>
          <p className="headline-lg mt-2 text-app-fg dark:text-zinc-50">{unmetDemand}</p>
          <p className="label-sm mt-2 text-app-faint dark:text-zinc-500">open opportunities</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Opportunities grid */}
        <div className="space-y-4 lg:col-span-2">
          <h2 className="label-md flex items-center gap-2 text-app-fg dark:text-zinc-50">
            <Lightbulb className="h-4 w-4 text-stitch-gold" /> Opportunities
          </h2>
          {opportunities.length === 0 ? (
            <div className="glass-card p-6">
              <p className="body-md text-app-muted dark:text-zinc-400">
                No opportunities detected yet — run a deep analysis to scan your area.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {opportunities.slice(0, 6).map((o) => {
                const conf = Number(o.confidence) || 0;
                return (
                  <div key={o.id} className="glass-card p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="label-md text-app-fg dark:text-zinc-100">{o.title}</h3>
                      <span
                        className={`label-sm shrink-0 rounded-full px-2 py-0.5 ${
                          conf >= 0.8
                            ? 'bg-stitch-gold/15 text-stitch-brass ring-1 ring-stitch-gold/50 dark:text-stitch-gold'
                            : 'bg-app-secondary-container text-app-on-secondary-container dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {conf >= 0.8 ? 'High Match' : 'Trending'}
                      </span>
                    </div>
                    <p className="body-md mt-2 line-clamp-3 text-app-muted dark:text-zinc-400">{o.description}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="label-sm text-app-faint dark:text-zinc-500">
                        confidence {Math.round(conf * 100)}%
                      </span>
                      <Link href="/dashboard/market/opportunities" className="label-sm text-app-secondary hover:opacity-80 dark:text-emerald-400">
                        Explore →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pricing matrix */}
          <h2 className="label-md mt-2 flex items-center gap-2 text-app-fg dark:text-zinc-50">
            <Star className="h-4 w-4 text-stitch-gold" /> Pricing & Rating Matrix
          </h2>
          <div className="glass-card overflow-x-auto p-2">
            {competitors.length === 0 ? (
              <p className="body-md p-4 text-app-muted dark:text-zinc-400">No competitors tracked yet.</p>
            ) : (
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-app-faint dark:text-zinc-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Venue</th>
                    <th className="px-4 py-2.5 font-medium">Distance</th>
                    <th className="px-4 py-2.5 font-medium">Rating</th>
                    <th className="px-4 py-2.5 font-medium">Position</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border/70 dark:divide-zinc-800">
                  {competitors.slice(0, 6).map((c) => {
                    const rating = Number(c.currentRating || 0);
                    return (
                      <tr key={c.id}>
                        <td className="px-4 py-2.5 font-medium text-app-fg dark:text-zinc-100">{c.name}</td>
                        <td className="px-4 py-2.5 text-app-muted dark:text-zinc-400">
                          {c.distanceKm ? `${Number(c.distanceKm).toFixed(1)} km` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-app-fg dark:text-zinc-200">
                          {rating ? rating.toFixed(1) : '—'} <span className="text-stitch-gold">★</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="h-2 w-full max-w-[160px] overflow-hidden rounded-full bg-app-surface-2 dark:bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-app-secondary dark:bg-emerald-500"
                              style={{ width: `${Math.min(100, (rating / 5) * 100)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Alerts rail */}
        <div className="space-y-4">
          <h2 className="label-md flex items-center gap-2 text-app-fg dark:text-zinc-50">
            <AlertTriangle className="h-4 w-4 text-app-error dark:text-orange-300" /> Alerts
          </h2>
          {alerts.length === 0 ? (
            <div className="glass-card p-6">
              <p className="body-md text-app-muted dark:text-zinc-400">No competitor moves detected this week.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {alerts.map((a) => (
                <li key={`${a.kind}-${a.id}`} className="glass-card p-4">
                  <span
                    className={`label-sm rounded-full px-2 py-0.5 ${
                      a.kind === 'Promotion'
                        ? 'bg-app-tertiary-container/40 text-app-tertiary dark:bg-blue-950 dark:text-blue-300'
                        : 'bg-stitch-gold/15 text-stitch-brass dark:text-stitch-gold'
                    }`}
                  >
                    {a.kind}
                  </span>
                  <p className="body-md mt-2 text-app-fg dark:text-zinc-200">{a.text}</p>
                  {a.when && (
                    <p className="label-sm mt-1 text-app-faint dark:text-zinc-500">
                      {new Date(a.when).toLocaleDateString('en-ZA')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="glass-card !bg-app-secondary-container/50 p-5 dark:!bg-emerald-950/40">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-app-on-secondary-container dark:text-emerald-300" />
              <h3 className="label-md text-app-on-secondary-container dark:text-emerald-200">Weekly Scan</h3>
            </div>
            <p className="body-md mt-2 text-app-on-secondary-container/90 dark:text-emerald-200/90">
              Ratings, menus and promotions refresh automatically every morning at 07:00.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
