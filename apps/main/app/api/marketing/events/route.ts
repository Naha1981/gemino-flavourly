import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  countMarketingEvents,
  createMarketingEvent,
  deleteMarketingEvent,
  getMarketingEvent,
  listMarketingEvents,
  updateMarketingEvent,
} from '@/lib/marketing/event-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const events = await listMarketingEvents(tenant.id);
  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const eventType = typeof body.event_type === 'string' ? body.event_type.trim() : '';
  const startsAt = typeof body.starts_at === 'string' ? new Date(body.starts_at) : null;
  const endsAt = typeof body.ends_at === 'string' ? new Date(body.ends_at) : null;

  if (!name || !eventType || !startsAt || !endsAt) {
    return NextResponse.json({ error: 'name, event_type, starts_at, and ends_at are required' }, { status: 400 });
  }

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return NextResponse.json({ error: 'starts_at and ends_at must be valid ISO dates' }, { status: 400 });
  }

  if (endsAt <= startsAt) {
    return NextResponse.json({ error: 'ends_at must be after starts_at' }, { status: 400 });
  }

  const allowed = ['special', 'live_music', 'tasting', 'workshop', 'holiday', 'custom'];
  if (!allowed.includes(eventType)) {
    return NextResponse.json({ error: `event_type must be one of ${allowed.join(', ')}` }, { status: 400 });
  }

  const description = typeof body.description === 'string' ? body.description.trim() : null;
  const location = typeof body.location === 'string' ? body.location.trim() : null;
  const capacity = typeof body.capacity === 'number' ? body.capacity : null;
  const message = typeof body.message === 'string' ? body.message.trim() : null;

  const event = await createMarketingEvent({
    tenantId: tenant.id,
    name,
    description,
    eventType,
    startsAt,
    endsAt,
    location,
    capacity,
    message,
  });

  return NextResponse.json({ ok: true, event }, { status: 201 });
}
