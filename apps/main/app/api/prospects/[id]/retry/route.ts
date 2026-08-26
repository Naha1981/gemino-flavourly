import { NextRequest, NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { getProspect, updateProspect } from '@/lib/brand-intelligence/prospect-store';
import { canRetry } from '@/lib/brand-intelligence/prospects';

export const runtime = 'nodejs';

/**
 * Super Admin — retry a failed prospect. Only allowed when attempts remain
 * (retries < 3) and the prospect hasn't already resolved ready/claimed.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  const prospect = await getProspect(params.id);
  if (!prospect) {
    return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
  }
  if (!canRetry(prospect.status as any, prospect.retries ?? 0)) {
    return NextResponse.json({ error: 'Prospect is not retryable' }, { status: 409 });
  }

  const updated = await updateProspect(prospect.id, { status: 'queued', error: null });
  return NextResponse.json({ ok: true, prospect: updated });
}
