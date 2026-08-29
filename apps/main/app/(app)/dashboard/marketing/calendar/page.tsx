import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { marketingCampaigns, marketingEvents } from '@/lib/db/schema';
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
          No campaigns or events scheduled for this month.
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
                <span className="text-xs text-zinc-500">{item.kind}</span>
              </div>
              {item.message && (
                <p className="mt-2 text-sm text-zinc-300">{item.message}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
                <span>From: {formatDate(item.startsAt)}</span>
                <span>To: {formatDate(item.endsAt)}</span>
                {item.location && <span>📍 {item.location}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
