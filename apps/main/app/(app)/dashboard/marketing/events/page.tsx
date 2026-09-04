import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { listMarketingEvents } from '@/lib/marketing/event-store';

export const dynamic = 'force-dynamic';

export default async function MarketingEventsPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const events = await listMarketingEvents(tenant.id);

  const typeColors: Record<string, string> = {
    special: 'bg-purple-950 text-purple-300',
    live_music: 'bg-pink-950 text-pink-300',
    tasting: 'bg-amber-950 text-amber-300',
    workshop: 'bg-blue-950 text-blue-300',
    holiday: 'bg-red-950 text-red-300',
    custom: 'bg-app-surface-1 text-app-muted',
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-app-surface-1 text-app-muted',
    published: 'bg-emerald-950 text-emerald-300',
    cancelled: 'bg-red-950 text-red-300',
    completed: 'bg-blue-950 text-blue-300',
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-app-border pb-4">
        <h1 className="text-xl font-semibold text-app-fg">Marketing Events</h1>
        <p className="text-xs text-app-muted">
          {events.length} event{events.length === 1 ? '' : 's'}. Manage specials, tastings, and live music.
        </p>
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-app-border bg-app-surface-0/30 p-8 text-center text-sm text-app-muted">
          No marketing events yet. Create your first event to start promoting special occasions.
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-app-fg">{event.name}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${typeColors[event.eventType] ?? typeColors.custom}`}>
                  {event.eventType.replace('_', ' ')}
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${statusColors[event.status] ?? statusColors.draft}`}>
                  {event.status}
                </span>
              </div>
              {event.description && (
                <p className="mt-2 text-xs text-app-muted">{event.description}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-app-faint">
                <span>{new Date(event.startsAt).toLocaleString()}</span>
                <span>→</span>
                <span>{new Date(event.endsAt).toLocaleString()}</span>
                {event.location && <span>📍 {event.location}</span>}
                {event.capacity && <span>Capacity: {event.capacity}</span>}
                {event.bookedCount && event.bookedCount > 0 && <span>Booked: {event.bookedCount}</span>}
              </div>
              {event.message && (
                <p className="mt-2 text-sm text-app-muted">{event.message}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
