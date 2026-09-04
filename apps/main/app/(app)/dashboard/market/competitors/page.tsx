import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Globe, MapPin, Percent, Radar, Swords, UtensilsCrossed } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  latestSnapshotsByCompetitor,
  listCompetitors,
  listMenuSnapshots,
  listPromotions,
  promotionCountsByCompetitor,
  recentMarketAlerts,
} from '@/lib/market/competitor-store';
import { diffMenus, itemsFromText } from '@/lib/market/menu-scraper';
import { AddCompetitorManuallyForm, DiscoverCompetitorsButton, RemoveCompetitorButton } from './market-actions';

export const dynamic = 'force-dynamic';

type MarketCompetitorsPageProps = {
  searchParams?: { selected?: string | string[] };
};

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().slice(0, 10);
}

function formatDistance(km: string | null): string {
  if (km === null) return '—';
  const value = Number(km);
  return Number.isFinite(value) ? `${value.toFixed(1)} km` : '—';
}

/**
 * Gates #15-#16 — Market Intelligence: competitors.
 *
 * Discovery (geocode + Places Nearby Search), the tracked list nearest-first,
 * manual entry, and — for the selected competitor — its menu history with the
 * change between snapshots highlighted, plus its promotion timeline. Alerts
 * from the daily sweep sit at the top.
 */
export default async function MarketCompetitorsPage({ searchParams }: MarketCompetitorsPageProps) {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const selectedRaw = Array.isArray(searchParams?.selected) ? searchParams.selected[0] : searchParams?.selected;

  const [rows, snapshots, promotionCounts, alerts] = await Promise.all([
    listCompetitors(tenant.id),
    latestSnapshotsByCompetitor(tenant.id),
    promotionCountsByCompetitor(tenant.id),
    recentMarketAlerts(tenant.id, 7),
  ]);

  const selectedRow = rows.find((row) => row.id === selectedRaw) ?? null;
  const selected = selectedRow
    ? {
        row: selectedRow,
        snapshots: await listMenuSnapshots(tenant.id, selectedRow.id, 20),
        promotions: await listPromotions(tenant.id, selectedRow.id, 20),
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 border-b border-app-border pb-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-app-fg">
          <Swords className="h-5 w-5 text-emerald-400" />
          Market Intelligence
        </h1>
        <p className="text-xs text-app-muted">
          Every restaurant within 5km, what they charge, and what they are running. Daily 8am sweep.{' '}
          <Link href="/dashboard/market/opportunities" className="text-emerald-400 hover:text-emerald-300">
            Opportunities
          </Link>{' '}
          ·{' '}
          <Link href="/dashboard/market/positioning" className="text-emerald-400 hover:text-emerald-300">
            Positioning
          </Link>
        </p>
      </div>

      {alerts.length > 0 && (
        <div className="rounded-lg border border-amber-900/70 bg-amber-950/30 p-4">
          <p className="text-sm font-medium text-amber-200">
            ⚠️ {alerts.length} competitor alert{alerts.length === 1 ? '' : 's'} this week
          </p>
          <ul className="mt-2 space-y-1">
            {alerts.slice(0, 5).map((alert, index) => (
              <li key={index} className="text-xs leading-relaxed text-amber-300/90">
                {alert}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DiscoverCompetitorsButton hasStoredAddress={Boolean(tenant.address)} />
      <AddCompetitorManuallyForm />

      <div className="space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-app-border bg-app-surface-0/30 p-8 text-center text-sm text-app-muted">
            No competitors tracked yet. Use <span className="text-app-fg">Discover Competitors</span> to find every
            restaurant within 5km, or add one by hand above.
          </div>
        ) : (
          rows.map((row) => {
            const snapshot = snapshots.get(row.id) ?? null;
            const promotions = promotionCounts.get(row.id) ?? 0;
            const isSelected = row.id === selectedRow?.id;
            return (
              <div
                key={row.id}
                className={`rounded-lg border p-4 ${isSelected ? 'border-emerald-800 bg-app-surface-0/80' : 'border-app-border bg-app-surface-0/50'}`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-app-fg">{row.name}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-app-muted">
                    <MapPin className="h-3 w-3 text-emerald-500" /> {formatDistance(row.distanceKm)}
                  </span>
                  {Number(row.currentRating) > 0 && (
                    <span className="text-xs text-amber-300">{Number(row.currentRating).toFixed(1)}★</span>
                  )}
                  {row.websiteUrl && (
                    <a
                      href={row.websiteUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-xs text-app-faint hover:text-app-muted"
                    >
                      <Globe className="h-3 w-3" /> website
                    </a>
                  )}
                  <span className="ml-auto text-xs text-app-faint">
                    menu snapshot {formatDate(snapshot?.snapshotAt)}
                    {snapshot?.priceRange ? ` · ${snapshot.priceRange}` : ''}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <Link
                    href={`/dashboard/market/competitors?selected=${row.id}`}
                    className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                  >
                    <UtensilsCrossed className="h-3 w-3" /> Menu history
                  </Link>
                  <span className="inline-flex items-center gap-1 text-app-muted">
                    <Percent className="h-3 w-3" /> {promotions} promotion{promotions === 1 ? '' : 's'} detected
                  </span>
                  {!row.websiteUrl && (
                    <span className="text-app-faint">no website — add one to start tracking their menu</span>
                  )}
                  <span className="ml-auto">
                    <RemoveCompetitorButton competitorId={row.id} competitorName={row.name} />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {selected && (
        <div className="space-y-4">
          <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium text-app-fg">
              <Radar className="h-4 w-4 text-emerald-400" /> {selected.row.name} — menu history
            </p>
            {selected.snapshots.length === 0 ? (
              <p className="text-xs text-app-faint">
                No snapshots yet — the daily 8am sweep records the first one, and the second one is where changes
                appear.
              </p>
            ) : (
              <ol className="space-y-3">
                {selected.snapshots.map((snapshot, index) => {
                  // Newest first, so the previous snapshot is the NEXT element.
                  const previous = selected.snapshots[index + 1];
                  const items = itemsFromText(snapshot.menuText);
                  const diff = previous ? diffMenus(itemsFromText(previous.menuText), items) : null;
                  return (
                    <li key={snapshot.id} className="rounded-md border border-app-border/70 bg-app-bg/40 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-app-fg">{formatDate(snapshot.snapshotAt)}</span>
                        {snapshot.priceRange && <span className="text-app-muted">{snapshot.priceRange}</span>}
                        <span className="text-app-faint">{items.length} items</span>
                        {!previous && <span className="rounded-full border border-app-border-strong px-2 text-[10px] text-app-muted">baseline</span>}
                        {diff?.hasChanges && (
                          <span className="rounded-full border border-amber-800/70 bg-amber-950/50 px-2 text-[10px] text-amber-300">
                            changed
                          </span>
                        )}
                        {snapshot.menuUrl && (
                          <a
                            href={snapshot.menuUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="ml-auto text-app-faint hover:text-app-muted"
                          >
                            source
                          </a>
                        )}
                      </div>

                      {diff?.hasChanges && (
                        <ul className="mt-2 space-y-1 text-xs">
                          {diff.newItems.map((item) => (
                            <li key={`new-${item.name}`} className="text-emerald-300">
                              + {item.name} ({`R${item.price}`})
                            </li>
                          ))}
                          {diff.removedItems.map((item) => (
                            <li key={`removed-${item.name}`} className="text-app-faint line-through">
                              − {item.name}
                            </li>
                          ))}
                          {diff.priceChanges.map((change) => (
                            <li key={`price-${change.name}`} className={change.delta > 0 ? 'text-red-300' : 'text-emerald-300'}>
                              ~ {change.name}: R{change.previousPrice} → R{change.currentPrice}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium text-app-fg">
              <Percent className="h-4 w-4 text-emerald-400" /> {selected.row.name} — promotions
            </p>
            {selected.promotions.length === 0 ? (
              <p className="text-xs text-app-faint">Nothing detected yet.</p>
            ) : (
              <ul className="space-y-2">
                {selected.promotions.map((promotion) => (
                  <li key={promotion.id} className="rounded-md border border-app-border/70 bg-app-bg/40 p-3 text-xs">
                    <p className="text-app-fg">{promotion.promotionText}</p>
                    <p className="mt-1 text-[10px] text-app-faint">
                      {formatDate(promotion.detectedAt)}
                      {promotion.source ? ` · ${promotion.source}` : ''}
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
