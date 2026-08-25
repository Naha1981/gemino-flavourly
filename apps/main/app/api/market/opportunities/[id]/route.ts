import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { markAddressed } from '@/lib/market/opportunity-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #17 — mark an opportunity as addressed (or un-mark it).
 *
 * Tenant-scoped: another tenant's opportunity id updates nothing and reads as
 * a 404, which is the same answer a non-existent id gets.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { addressed?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  // Absent body means "mark as addressed" — that is the only action the UI
  // exposes, and a PATCH with no payload should still do the obvious thing.
  const addressed = body.addressed === undefined ? true : Boolean(body.addressed);

  const updated = await markAddressed(tenant.id, params.id, addressed);
  if (!updated) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });

  return NextResponse.json({ ok: true, id: params.id, addressed });
}
