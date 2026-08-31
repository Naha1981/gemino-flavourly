import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { completeVisitAndEarn } from '@/lib/customer/reward-claim-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * O1 — "Complete & Earn" staff endpoint.
 *
 * Marks a reservation completed (when still confirmed) and awards its
 * loyalty points exactly once per reservation (ref_id `visit:{id}`).
 * Tenant-scoped via the resolved tenant: a reservation id from another
 * tenant simply reads as not_found, which is the isolation contract the
 * rest of the API follows.
 *
 * POST /api/loyalty/complete-visit  body: { reservationId: string, spendCents?: number }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { reservationId, spendCents } = (body ?? {}) as {
    reservationId?: unknown;
    spendCents?: unknown;
  };
  if (typeof reservationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(reservationId)) {
    return NextResponse.json({ error: 'reservationId (uuid) is required' }, { status: 400 });
  }
  if (spendCents !== undefined && spendCents !== null && typeof spendCents !== 'number') {
    return NextResponse.json({ error: 'spendCents must be a number' }, { status: 400 });
  }

  const result = await completeVisitAndEarn({
    tenantId: tenant.id,
    reservationId,
    spendCents: typeof spendCents === 'number' ? spendCents : null,
  });

  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 422;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({
    ok: true,
    points: result.points,
    contactPoints: result.contactPoints,
    alreadyEarned: result.alreadyEarned,
  });
}
