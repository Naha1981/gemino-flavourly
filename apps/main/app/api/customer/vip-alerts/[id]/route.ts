import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  addVipAlertNote,
  markVipAlertServed,
} from '@/lib/customer/vip-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #10 — VIP alert quick actions.
 *
 * PATCH: mark an alert as served and/or attach a staff note. Both are
 * tenant-scoped in the store (tenant.id AND alert id), so one restaurant can
 * never mutate another restaurant's alert even if a uuid leaks.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { served?: unknown; note?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const alertId = params.id;
  const markServed = body.served === true || body.action === 'mark_served';
  const note = typeof body.note === 'string' ? body.note.trim() : null;

  if (!markServed && !note) {
    return NextResponse.json(
      { error: 'Nothing to update: send { served: true } and/or { note: "..." }' },
      { status: 400 }
    );
  }

  if (markServed) {
    const changed = await markVipAlertServed(tenant.id, alertId);
    if (!changed) {
      return NextResponse.json({ error: 'VIP alert not found or already served' }, { status: 404 });
    }
  }

  if (note) {
    await addVipAlertNote(tenant.id, alertId, note);
  }

  return NextResponse.json({ ok: true });
}
