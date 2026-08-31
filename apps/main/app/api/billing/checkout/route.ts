import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getBillingProvider } from '@/lib/billing/payfast';
import { isPlanTier } from '@/lib/billing/provider';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/checkout — build a PayFast subscription checkout for the
 * chosen tier and return the redirect URL. Auth: signed-in tenant.
 */
export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const tier = body.tier;
  if (!isPlanTier(tier)) {
    return NextResponse.json(
      { error: "tier must be one of: starter, casual, premium, signature, group" },
      { status: 400 }
    );
  }

  // Same fallback domain as lib/billing/payfast.ts uses for cancel_url and
  // notify_url. These two previously disagreed ('flavourly.app' here vs
  // 'gemino.app' there), so with NEXT_PUBLIC_APP_URL unset the return_url
  // pointed at a different domain than the rest of the checkout — and the
  // notify_url fallback silently misdirected PayFast's ITN. One constant,
  // imported, so they can never drift apart again.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://gemino.app';
  const returnUrl =
    typeof body.return_url === 'string' && body.return_url
      ? body.return_url
      : `${appUrl}/dashboard?billing=success`;

  try {
    const provider = getBillingProvider();
    const { redirectUrl } = await provider.createSubscriptionCheckout({
      tenantId: tenant.id,
      tier,
      returnUrl,
    });
    return NextResponse.json({ ok: true, redirectUrl });
  } catch (err: any) {
    console.error(`[Billing] Checkout failed for tenant ${tenant.id}:`, err);
    return NextResponse.json(
      { error: err.message || 'Failed to create checkout' },
      { status: 500 }
    );
  }
}
