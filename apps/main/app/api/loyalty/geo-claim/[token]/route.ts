import { NextRequest, NextResponse } from 'next/server';
import { verifyRewardEventWithLocation } from '@/lib/customer/reward-claim-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * O1 — geo-claim verification endpoint (guest-facing, NO Clerk auth).
 *
 * The credential is the single-use claim token in the path: the guest opened
 * a link the WhatsApp responder sent them. Public prefix
 * '/api/loyalty/geo-claim' is scoped in route-guard-core so this route alone
 * is reachable signed-out — complete-visit (staff) stays behind Clerk.
 *
 * POST /api/loyalty/geo-claim/[token]  body: { lat: number, lng: number }
 * Responses are deliberately flat and copy-free: the guest page renders its
 * own friendly copy per outcome, so this JSON is a contract, not prose.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  const token = params.token;
  if (!token || !/^[a-f0-9]{16,128}$/i.test(token)) {
    return NextResponse.json({ outcome: 'not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { lat, lng } = (body ?? {}) as { lat?: unknown; lng?: unknown };
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (
    !Number.isFinite(latNum) ||
    !Number.isFinite(lngNum) ||
    Math.abs(latNum) > 90 ||
    Math.abs(lngNum) > 180
  ) {
    return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
  }

  try {
    const result = await verifyRewardEventWithLocation({
      token,
      guest: { lat: latNum, lng: lngNum },
    });
    const status =
      result.outcome === 'not_found'
        ? 404
        : result.outcome === 'restaurant_location_missing'
          ? 503
          : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    console.error('[geo-claim] verification failed:', err);
    // Fail closed: never tell a guest "verified" on an internal error.
    return NextResponse.json({ outcome: 'not_found' }, { status: 500 });
  }
}
