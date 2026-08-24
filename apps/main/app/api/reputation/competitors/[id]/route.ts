import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { deleteCompetitor } from '@/lib/reputation/competitor-store';

export const dynamic = 'force-dynamic';

/** Gate #14 — remove a competitor. Tenant-scoped: another tenant's id deletes nothing. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const deleted = await deleteCompetitor(tenant.id, params.id);
  if (!deleted) {
    return NextResponse.json({ error: 'Competitor not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: params.id });
}
