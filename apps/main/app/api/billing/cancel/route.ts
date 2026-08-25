import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getBillingProvider } from '@/lib/billing/payfast';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/cancel — stop the tenant's tokenized subscription via
 * PayFast and set plan_status='canceled'. Auth: signed-in tenant.
 */
export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const provider = getBillingProvider();
    await provider.cancelSubscription(tenant.id);
    return NextResponse.json({ ok: true, status: 'canceled' });
  } catch (err: any) {
    console.error(`[Billing] Cancel failed for tenant ${tenant.id}:`, err);
    return NextResponse.json(
      { error: err.message || 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}
