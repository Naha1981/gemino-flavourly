import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { marketingCampaigns, marketingEvents, waAccounts } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
}

type CalendarItem = {
  id: string;
  kind: 'campaign' | 'event';
  name: string;
  type: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  launchedAt?: Date | null;
  location?: string | null;
  message?: string | null;
};

export default async function MarketingCalendarPage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const monthParam = searchParams?.month ?? new Date().toISOString().slice(0, 7);
  const month = new Date(monthParam + '-01');
  if (Number.isNaN(month.getTime())) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300">
        Invalid month format. Use YYYY-MM.
      </div>
    );
  }

  const rangeStart = startOfMonth(month);
  const rangeEnd = endOfMonth(month);

  // UI-3R / F4 (S20) — "scheduled" is a lie by omission while WhatsApp is
  // disconnected: nothing can send. Items stay visible but carry the amber
  // "blocked until WhatsApp connected" chip instead of pretending to run.
  const [waAccount] = await db
    .select({ isConnected: waAccounts.isConnected })
    .from(waAccounts)
    .where(eq(waAccounts.tenantId, tenant.id))
    .limit(1)
    .catch(() => [{ isConnected: false }]);
  const waConnected = Boolean(waAccount?.isConnected);

  const [campaigns, events] = await Promise.all([
    db.select().from(marketingCampaigns).where(
      and(
        eq(marketingCampaigns.tenantId, tenant.id),
        sql`(${marketingCampaigns.startDate} IS NOT NULL AND ${marketingCampaigns.startDate} <= ${rangeEnd}) OR (${marketingCampaigns.endDate} IS NOT NULL AND ${marketingCampaigns.endDate} >= ${rangeStart}) OR (${marketingCampaigns.launchedAt} IS NOT NULL AND ${marketingCampaigns.launchedAt} >= ${rangeStart} AND ${marketingCampaigns.launchedAt} <= ${rangeEnd})`
      )
    ).orderBy(marketingCampaigns.startDate),
    db.select().from(marketingEvents).where(
      and(
        eq(marketingEvents.tenantId, tenant.id),
        sql`(${marketingEvents.startsAt} <= ${rangeEnd} AND ${marketingEvents.endsAt} >= ${rangeStart})`
      )
    ).orderBy(marketingEvents.startsAt),
  ]);

  const items: CalendarItem[] = [
    ...campaigns.map((c) => ({
      id: c.id,
      kind: 'campaign' as const,
      name: c.name,
      type: c.type,
      status: c.status,
      startsAt: c.startDate,
      endsAt: c.endDate,
      launchedAt: c.launchedAt,
      message: c.message,
    })),
    ...events.map((e) => ({
      id: e.id,
      kind: 'event' as const,
      name: e.name,
      type: e.eventType,
      status: e.status,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      location: e.location,
      message: e.message,
    })),
  ].sort((a, b) => new Date(a.startsAt ?? '').getTime() - new Date(b.startsAt ?? '').getTime());

  const typeColors: Record<string, string> = {
    promotion: 'bg-emerald-950 text-emerald-300',
    event: 'bg-blue-950 text-blue-300',
    seasonal: 'bg-amber-950 text-amber-300',
    announcement: 'bg-purple-950 text-purple-300',
    custom: 'bg-zinc-800 text-zinc-300',
    special: 'bg-purple-950 text-purple-300',
    live_music: 'bg-pink-950 text-pink-300',
    tasting: 'bg-amber-950 text-amber-300',
    workshop: 'bg-blue-950 text-blue-300',
    holiday: 'bg-red-950 text-red-300',
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-zinc-800 text-zinc-300',
    scheduled: 'bg-blue-950 text-blue-300',
    published: 'bg-emerald-950 text-emerald-300',
    sent: 'bg-emerald-950 text-emerald-300',
    cancelled: 'bg-red-950 text-red-300',
    completed: 'bg-blue-950 text-blue-300',
    failed: 'bg-red-950 text-red-300',
  };

  const formatDate = (value: Date | null) => {
    if (!value) return '—';
    return value.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-4">
        <h1 className="text-xl font-semibold text-zinc-50">Marketing Calendar</h1>
        <p className="text-xs text-zinc-400">
          {items.length} item{items.length === 1 ? '' : 's'} in {month.toLocaleString(undefined, { month: 'long', year: 'numeric' })}.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-400">
          No campaigns or events scheduled for this month.{' '}
          {!waConnected && 'Connect WhatsApp so scheduled items can actually send.'}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={`${item.kind}-${item.id}`} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-zinc-100">{item.name}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${typeColors[item.type] ?? typeColors.custom}`}>
                  {item.type.replace('_', ' ')}
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${statusColors[item.status] ?? statusColors.draft}`}>
                  {item.status}
                </span>
                {/* F4 (S20): truthful send state for anything that must go out
                    over WhatsApp. */}
                {!waConnected && (item.status === 'scheduled' || item.status === 'published') && (
                  <span className="inline-flex items-center rounded-full border border-amber-700/60 bg-amber-950/40 px-2 py-0.5 text-xs text-amber-300">
                    blocked until WhatsApp connected
                  </span>
                )}
                {/* F10 (S21): margin-affecting offers route to Approvals so the
                    owner signs off on promises like "10% off" or "free item"
                    before they ever go out. */}
                {(item.status === 'scheduled' || item.status === 'published') && item.message && /off|free|complimentary|discount|%|R\d/i.test(item.message) && (
                  <Link
                    href="/dashboard/operations/approval-requests"
                    className="inline-flex items-center rounded-full border border-sky-800/60 bg-sky-950/40 px-2 py-0.5 text-xs text-sky-300 hover:bg-sky-900/40"
                    title="Margin-affecting offers should be approved before they send"
                  >
                    offer needs approval →
                  </Link>
                )}
                <span className="text-xs text-zinc-500">{item.kind}</span>
              </div>
              {item.message && (
                <p className="mt-2 text-sm text-zinc-300">{item.message}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
                <span>From: {formatDate(item.startsAt)}</span>
                {/* F10 (S23): "To: —" never renders — the segment hides when
                    there is no real end date. */}
                {item.endsAt && <span>To: {formatDate(item.endsAt)}</span>}
                {item.location && <span>📍 {item.location}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
