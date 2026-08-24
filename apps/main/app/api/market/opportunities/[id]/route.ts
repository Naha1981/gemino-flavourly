import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { markAddressed } from '@/lib/market/opportunity-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #17 — mark an opportunity as addressed. Tenant-scoped and one-way
 * (false -> true): the flag is the tenant's "we did this" record and re-runs
 * of the analyzer never clear it.
 */
export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const changed = await markAddressed(tenant.id, params.id);
  if (!changed) {
    return NextResponse.json({ error: 'Opportunity not found or already addressed' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, addressed: params.id });
}
