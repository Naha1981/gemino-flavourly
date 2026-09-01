import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Lightbulb, Swords } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { getOpportunities } from '@/lib/market/opportunity-store';
import { listCompetitors } from '@/lib/market/competitor-store';
import { AnalyzeMarketButton, MarkAddressedButton } from './opportunity-actions';

export const dynamic = 'force-dynamic';

const TYPE_META: Record<string, { label: string; classes: string }> = {
  meal_gap: { label: 'Meal gap', classes: 'border-emerald-800/70 bg-emerald-950/40 text-emerald-300' },
  cuisine_gap: { label: 'Cuisine gap', classes: 'border-sky-800/70 bg-sky-950/40 text-sky-300' },
  price_gap: { label: 'Price gap', classes: 'border-amber-800/70 bg-amber-950/40 text-amber-300' },
  time_gap: { label: 'Day/time gap', classes: 'border-violet-800/70 bg-violet-950/40 text-violet-300' },
};

function formatDate(value: Date | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
}

/**
 * Gate #17 — market opportunities.
 *
 * Every row is a gap the analyzer found in the tenant's 5km market, with the
 * evidence behind it and the confidence that evidence supports. "Mark as
 * addressed" is the owner's own bookkeeping; a re-run refreshes the numbers
 * but never clears that flag.
 */
export default async function MarketOpportunitiesPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const [rows, competitors] = await Promise.all([getOpportunities(tenant.id), listCompetitors(tenant.id)]);

  const openItems = rows.filter((row) => !row.addressed);
  const done = rows.filter((row) => row.addressed);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 border-b border-zinc-800 pb-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
          <Lightbulb className="h-5 w-5 text-emerald-400" />
          Market Opportunities
        </h1>
        <p className="text-xs text-zinc-400">
          Gaps in your 5km market — meals, cuisines, price bands and dayparts nobody else covers.{' '}
          <Link href="/dashboard/market/competitors" className="text-emerald-400 hover:text-emerald-300">
            Competitors
          </Link>{' '}
          ·{' '}
          <Link href="/dashboard/market/positioning" className="text-emerald-400 hover:text-emerald-300">
            Positioning
          </Link>
        </p>
      </div>

      {competitors.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6 text-sm text-zinc-400">
          No competitors tracked yet, so there is nothing to compare against.{' '}
          <Link href="/dashboard/market/competitors" className="text-emerald-400 hover:text-emerald-300">
            Discover competitors
          </Link>{' '}
          first — the daily sweep scrapes their menus, and this page fills in from there.
        </div>
      )}

      <AnalyzeMarketButton />

      <div className="space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-400">
            No opportunities detected yet. Run the analysis above once a few competitors have menu snapshots, or wait
            as sweeps run daily over your tracked competitors.
          </div>
        ) : (
          <>
            {openItems.map((row) => {
              const meta = TYPE_META[row.opportunityType] ?? { label: row.opportunityType, classes: 'border-zinc-700 bg-zinc-800 text-zinc-300' };
              const confidence = Number(row.confidence);
              const evidence = Array.isArray(row.evidence) ? (row.evidence as string[]) : [];
              return (
                <div key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.classes}`}>
                      {meta.label}
                    </span>
                    <span className="text-sm font-medium text-zinc-100">{row.title}</span>
                    <span className="ml-auto text-right">
                      <span className="block text-xs text-zinc-500">score</span>
                      <span className="text-sm font-semibold text-emerald-300">{confidence.toFixed(2)}</span>
                    </span>
                  </div>

                  <p className="mt-2 text-xs leading-relaxed text-zinc-400">{row.description}</p>

                  {evidence.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {evidence.map((item, index) => (
                        <li key={index} className="text-[11px] text-zinc-500">
                          · {item}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <MarkAddressedButton opportunityId={row.id} title={row.title} addressed={false} />
                    <div className="h-1 w-32 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full bg-emerald-500" style={{ width: `${Math.round(confidence * 100)}%` }} />
                    </div>
                    <span className="ml-auto text-[11px] text-zinc-600">detected {formatDate(row.detectedAt)}</span>
                  </div>
                </div>
              );
            })}

            {done.length > 0 && (
              <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-4">
                <p className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-300">
                  <Swords className="h-3.5 w-3.5 text-zinc-500" /> Addressed ({done.length})
                </p>
                <ul className="space-y-2">
                  {done.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="text-zinc-400">{row.title}</span>
                      <span className="text-[11px]">score {Number(row.confidence).toFixed(2)}</span>
                      <span className="ml-auto">
                        <MarkAddressedButton opportunityId={row.id} title={row.title} addressed />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
