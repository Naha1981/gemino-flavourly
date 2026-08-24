import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Radar, Utensils } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  getCompetitor,
  getMenuHistory,
  listCompetitors,
  listPromotionsForCompetitor,
  recentMarketAlerts,
} from '@/lib/market/competitor-store';
import { compareMenus, type MenuItem } from '@/lib/market/menu-scraper';
import { DiscoverCompetitorsButton, AddCompetitorForm } from './competitor-forms';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams?: { selected?: string | string[] };
};

function formatKm(value: string | null): string {
  if (value == null) return '—';
  const km = Number(value);
  if (!Number.isFinite(km)) return '—';
  return `${km.toFixed(1)} km`;
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

function parseItems(raw: unknown): MenuItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is { name: string; priceCents: number } =>
      typeof (item as { name?: unknown })?.name === 'string' &&
      typeof (item as { priceCents?: unknown })?.priceCents === 'number')
    .map((item) => ({ name: item.name, priceCents: item.priceCents }));
}

/**
 * Gate #15/#16 — market intelligence home: discovery, the tracked list, and
 * the selected competitor's menu-history timeline (with highlighted diffs)
 * and promotion timeline.
 */
export default async function MarketCompetitorsPage({ searchParams }: PageProps) {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const selectedRaw = Array.isArray(searchParams?.selected) ? searchParams.selected[0] : searchParams?.selected;

  const rows = await listCompetitors(tenant.id);
  const [alerts, selected, history, promotions] = await Promise.all([
    recentMarketAlerts(tenant.id, 30),
    selectedRaw ? getCompetitor(tenant.id, selectedRaw) : null,
    selectedRaw ? getMenuHistory(tenant.id, selectedRaw) : [],
    selectedRaw ? listPromotionsForCompetitor(tenant.id, selectedRaw, 90) : [],
  ]);

  const promoAlertCount = alerts.filter((a) => a.includes('launched a promotion')).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
            <Radar className="h-5 w-5 text-emerald-400" />
            Market Intelligence
          </h1>
          <p className="text-xs text-zinc-400">
            Competitors within 5km, tracked daily for menu, price and promotion changes at 8am.{' '}
            <Link href="/dashboard/market/opportunities" className="text-emerald-400 hover:text-emerald-300">
              Opportunities
            </Link>{' '}
            ·{' '}
            <Link href="/dashboard/market/positioning" className="text-emerald-400 hover:text-emerald-300">
              Positioning
            </Link>
          </p>
        </div>
        <DiscoverCompetitorsButton />
      </div>

      {alerts.length > 0 && (
        <div className="rounded-lg border border-amber-900/70 bg-amber-950/30 p-4">
          <p className="text-sm font-medium text-amber-200">
            ⚠️ {promoAlertCount > 0
              ? `${promoAlertCount} competitor${promoAlertCount === 1 ? '' : 's'} launched promotion${promoAlertCount === 1 ? '' : 's'} recently`
              : 'Competitor market movement detected'}
          </p>
          <ul className="mt-2 space-y-1">
            {alerts.slice(0, 5).map((alert, i) => (
              <li key={i} className="text-xs leading-relaxed text-amber-300/90">
                {alert}
              </li>
            ))}
          </ul>
        </div>
      )}

      <AddCompetitorForm />

      <div className="space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-400">
            No competitors tracked yet — hit <span className="text-zinc-200">Discover Competitors</span> to find
            restaurants within 5km, or add one manually above.
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-zinc-100">{row.name}</span>
                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                  {formatKm(row.distanceKm)}
                </span>
                {row.rating != null && (
                  <span className="text-sm text-amber-300">{Number(row.rating).toFixed(1)}★</span>
                )}
                {row.websiteUrl && (
                  <a
                    href={row.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    website ↗
                  </a>
                )}
                <span className="ml-auto text-xs text-zinc-500">
                  last menu snapshot {formatDate(history[0]?.snapshotAt ?? null) === '—' ? 'none yet' : formatDate(history[0]?.snapshotAt ?? null)}
                </span>
              </div>
              <div className="mt-2">
                <Link
                  href={`/dashboard/market/competitors?selected=${row.id}`}
                  className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                >
                  <Utensils className="h-3 w-3" /> Menu history, promotions & positioning
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      {selected && (
        <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm font-medium text-zinc-100">{selected.name} — tracking timeline</p>

          <div>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Menu snapshots</p>
            {history.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No snapshots yet — the next 8am sweep (or a saved website URL) starts the timeline.
              </p>
            ) : (
              <div className="space-y-3">
                {history.map((snapshot, i) => {
                  const older = history[i + 1]; // newest first
                  const diff = older ? compareMenus(parseItems(older.menuItems), parseItems(snapshot.menuItems)) : null;
                  return (
                    <div key={snapshot.id} className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-zinc-300">{formatDate(snapshot.snapshotAt)}</span>
                        <span className="text-zinc-500">·</span>
                        <span className="text-zinc-400">{snapshot.priceRange ?? 'no prices parsed'}</span>
                        {!older && <span className="text-zinc-600">(baseline)</span>}
                        {diff?.hasChanges && (
                          <span className="rounded-full border border-amber-800/70 bg-amber-950/60 px-2 py-0.5 text-[10px] text-amber-300">
                            changed
                          </span>
                        )}
                      </div>
                      {diff && diff.hasChanges && (
                        <ul className="mt-2 space-y-1 text-xs">
                          {diff.newItems.slice(0, 5).map((item) => (
                            <li key={`n-${item.name}`} className="text-emerald-400">
                              + {item.name} (R{(item.priceCents / 100).toFixed(0)})
                            </li>
                          ))}
                          {diff.removedItems.slice(0, 5).map((item) => (
                            <li key={`r-${item.name}`} className="text-red-400">
                              − {item.name}
                            </li>
                          ))}
                          {diff.priceChanges.slice(0, 5).map((change) => (
                            <li key={`p-${change.name}`} className="text-amber-300">
                              ± {change.name}: R{(change.fromCents / 100).toFixed(0)} → R{(change.toCents / 100).toFixed(0)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Promotions (last 90 days)</p>
            {promotions.length === 0 ? (
              <p className="text-xs text-zinc-500">No promotions detected.</p>
            ) : (
              <ul className="space-y-1.5">
                {promotions.map((promotion) => (
                  <li key={promotion.id} className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                    <p className="text-xs text-zinc-200">{promotion.promotionText}</p>
                    <p className="mt-0.5 text-[10px] text-zinc-500">
                      {formatDate(promotion.detectedAt)} · via {promotion.source ?? 'website'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
