import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Lightbulb } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { getOpportunities } from '@/lib/market/opportunity-store';
import { analyzeOpportunities, type CompetitorEvidence } from '@/lib/market/opportunity-analyzer';
import { getLatestMenuSnapshot, listCompetitors } from '@/lib/market/competitor-store';
import { saveOpportunities } from '@/lib/market/opportunity-store';
import { MarkAddressedButton } from './mark-addressed-button';

export const dynamic = 'force-dynamic';

const CATEGORY_LABELS: Record<string, string> = {
  meal_type: 'Meal type',
  cuisine: 'Cuisine',
  price_point: 'Price point',
  time_slot: 'Day / time',
};

/**
 * Gate #17 — market opportunity board. Analysis runs server-side over the
 * latest competitor evidence; upsert-by-key means the tenant's "addressed"
 * marks survive every refresh.
 */
export default async function OpportunitiesPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  // Re-run the analysis so the board reflects the current market…
  const competitors = await listCompetitors(tenant.id);
  const evidence: CompetitorEvidence[] = await Promise.all(
    competitors.map(async (row) => {
      const snapshot = await getLatestMenuSnapshot(row.id).catch(() => null);
      const items = Array.isArray(snapshot?.menuItems)
        ? (snapshot!.menuItems as Array<{ name?: unknown; priceCents?: unknown }>)
            .filter(
              (item): item is { name: string; priceCents: number } =>
                typeof item?.name === 'string' && typeof item?.priceCents === 'number'
            )
            .map((item) => ({ name: item.name, priceCents: item.priceCents }))
        : [];
      return { name: row.name, menuText: snapshot?.menuText ?? null, items, priceLevel: null };
    })
  );
  await saveOpportunities(tenant.id, analyzeOpportunities(evidence, { radiusKm: 5 })).catch(() => undefined);

  const rows = await getOpportunities(tenant.id);
  const open = rows.filter((row) => !row.addressed);
  const addressed = rows.filter((row) => row.addressed);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
            <Lightbulb className="h-5 w-5 text-emerald-400" />
            Market Opportunities
          </h1>
          <p className="text-xs text-zinc-400">
            Gaps nobody in your 5km radius covers, scored by evidence.{' '}
            <Link href="/dashboard/market/competitors" className="text-emerald-400 hover:text-emerald-300">
              Back to competitors
            </Link>
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {open.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-400">
            {competitors.length === 0
              ? 'Discover competitors first — opportunities are scored against the tracked market.'
              : 'No open gaps detected in your tracked market right now.'}
          </div>
        ) : (
          open.map((row) => (
            <div key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                  {CATEGORY_LABELS[row.category] ?? row.category}
                </span>
                <span className="text-xs text-zinc-500">
                  confidence {(Number(row.confidence) * 100).toFixed(0)}%
                </span>
                <div className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-emerald-500/70"
                    style={{ width: `${Math.round(Number(row.confidence) * 100)}%` }}
                  />
                </div>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-200">{row.description} within 5km.</p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Opportunity score: {Number(row.confidence).toFixed(2)} · based on{' '}
                {(row.evidence as { competitorsScanned?: number }).competitorsScanned ?? 0} tracked competitors
              </p>
              <div className="mt-3">
                <MarkAddressedButton opportunityId={row.id} />
              </div>
            </div>
          ))
        )}
      </div>

      {addressed.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Addressed by you</p>
          <ul className="space-y-1.5">
            {addressed.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-400"
              >
                <span className="text-emerald-500">✓</span>
                <span className="line-through decoration-zinc-600">{row.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
