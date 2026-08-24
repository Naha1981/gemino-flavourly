import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Scale } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { getLatestMenuSnapshot, getSelfCompetitor, listCompetitors } from '@/lib/market/competitor-store';
import { buildPositioningReport } from '@/lib/market/positioning-analyzer';
import { getAverageRating } from '@/lib/reputation/review-store';

export const dynamic = 'force-dynamic';

interface ParsedItems {
  names: string[];
  avgRands: number | null;
}

function parseSnapshot(raw: unknown): ParsedItems {
  if (!Array.isArray(raw) || raw.length === 0) return { names: [], avgRands: null };
  const priced = (raw as Array<{ name?: unknown; priceCents?: unknown }>).filter(
    (item) => typeof item?.name === 'string' && typeof item?.priceCents === 'number'
  );
  if (priced.length === 0) return { names: [], avgRands: null };
  const totalCents = priced.reduce((sum, item) => sum + (item.priceCents as number), 0);
  return { names: priced.map((item) => item.name as string), avgRands: totalCents / priced.length / 100 };
}

const PRICE_CLASS_STYLES: Record<string, string> = {
  budget: 'border-emerald-800/70 bg-emerald-950/60 text-emerald-300',
  'mid-range': 'border-blue-800/70 bg-blue-950/60 text-blue-300',
  premium: 'border-amber-800/70 bg-amber-950/60 text-amber-300',
  unknown: 'border-zinc-700 bg-zinc-800/80 text-zinc-400',
};

/**
 * Gate #18 — positioning dashboard: price chart (tenant vs market), rating
 * ranking, menu overlap analysis, unique selling points.
 */
export default async function PositioningPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const [selfRow, competitorRows, tenantRating] = await Promise.all([
    getSelfCompetitor(tenant.id),
    listCompetitors(tenant.id),
    getAverageRating(tenant.id).catch(() => 0),
  ]);

  const selfSnapshot = selfRow
    ? await getLatestMenuSnapshot(selfRow.id).catch(() => null)
    : null;
  const selfMenu = parseSnapshot(selfSnapshot?.menuItems);

  const competitors = await Promise.all(
    competitorRows.map(async (row) => {
      const parsed = parseSnapshot((await getLatestMenuSnapshot(row.id).catch(() => null))?.menuItems);
      return {
        name: row.name,
        rating: row.rating != null ? Number(row.rating) : null,
        avgItemRands: parsed.avgRands,
        menuItems: parsed.names,
      };
    })
  );

  const report = buildPositioningReport(
    { name: tenant.name, rating: tenantRating, avgItemRands: selfMenu.avgRands, menuItems: selfMenu.names },
    competitors
  );

  const maxPrice = Math.max(
    report.price.tenantAvgRands ?? 0,
    report.price.marketMaxRands ?? 0,
    1
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
            <Scale className="h-5 w-5 text-emerald-400" />
            Positioning
          </h1>
          <p className="text-xs text-zinc-400">
            Your prices, rating and menu versus the tracked market.{' '}
            <Link href="/dashboard/market/competitors" className="text-emerald-400 hover:text-emerald-300">
              Back to competitors
            </Link>
          </p>
        </div>
      </div>

      {/* Price positioning chart */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="mb-3 text-xs font-medium text-zinc-300">Price positioning (average menu item)</p>
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs">
            <span className="w-32 truncate text-zinc-100">{tenant.name} (you)</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.round(((report.price.tenantAvgRands ?? 0) / maxPrice) * 100)}%` }}
              />
            </div>
            <span className="w-16 text-right text-zinc-300">
              {report.price.tenantAvgRands != null ? `R${report.price.tenantAvgRands.toFixed(0)}` : '—'}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] ${PRICE_CLASS_STYLES[report.price.tenantClass]}`}
            >
              {report.price.tenantClass}
            </span>
          </div>
          {report.price.competitorClasses.map((row, i) => {
            const avg = competitors[i]?.avgItemRands ?? 0;
            return (
              <div key={row.competitor} className="flex items-center gap-3 text-xs">
                <span className="w-32 truncate text-zinc-400">{row.competitor}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-zinc-600" style={{ width: `${Math.round((avg / maxPrice) * 100)}%` }} />
                </div>
                <span className="w-16 text-right text-zinc-500">{avg > 0 ? `R${avg.toFixed(0)}` : '—'}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${PRICE_CLASS_STYLES[row.priceClass]}`}>
                  {row.priceClass}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-zinc-400">{report.price.summary}</p>
      </div>

      {/* Rating ranking */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="mb-3 text-xs font-medium text-zinc-300">Rating ranking</p>
        <p className="text-sm text-zinc-200">{report.rating.summary}</p>
        {report.rating.rank > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            {report.rating.rank === 1
              ? '🥇 You lead the market.'
              : `Ahead of: ${report.rating.aheadOf.join(', ') || 'nobody'}`}
          </p>
        )}
      </div>

      {/* Menu overlap */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="mb-3 text-xs font-medium text-zinc-300">Menu overlap analysis</p>
        <p className="text-sm text-zinc-200">{report.menu.summary}</p>
        {report.menu.overlapRows.length > 0 && (
          <div className="mt-3 space-y-2">
            {report.menu.overlapRows.map((row) => (
              <div key={row.competitor} className="flex items-center gap-3 text-xs">
                <span className="w-32 truncate text-zinc-400">{row.competitor}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-blue-500/70" style={{ width: `${Math.round(row.overlap * 100)}%` }} />
                </div>
                <span className="w-24 text-right text-zinc-500">
                  {Math.round(row.overlap * 100)}% ({row.sharedCount}/{row.competitorItemCount})
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Unique selling points */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="mb-3 text-xs font-medium text-zinc-300">Your unique offerings</p>
        {report.menu.uniqueOfferings.length === 0 ? (
          <p className="text-xs text-zinc-500">
            {selfMenu.names.length === 0
              ? 'Your own menu is not tracked yet — run Discover Competitors so your Google place is tagged as yours, or add your website URL to a competitor row named after yourself.'
              : 'Every item you serve is also offered by a tracked competitor — differentiation may live outside the menu (service, venue, experience).'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {report.menu.uniqueOfferings.map((item) => (
              <span
                key={item}
                className="rounded-full border border-emerald-800/70 bg-emerald-950/60 px-3 py-1 text-xs text-emerald-300"
              >
                {item}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
