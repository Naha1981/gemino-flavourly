import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { evaluateBillingGate } from '@/lib/billing/gate-evaluate';
import { isPlanTier, PLAN_TIERS, type PlanTier } from '@/lib/billing/provider';
import { TIER_CENTS, TIER_SETUP_CENTS } from '@/lib/billing/payfast';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';

export const dynamic = 'force-dynamic';

interface TierInfo {
  id: PlanTier;
  name: string;
  monthlyZAR: number;
  setupZAR: number;
  description: string;
}

const TIERS: TierInfo[] = [
  { id: 'starter', name: 'Starter', monthlyZAR: TIER_CENTS.starter / 100, setupZAR: TIER_SETUP_CENTS.starter / 100, description: 'Kota / takeaway' },
  { id: 'casual', name: 'Casual', monthlyZAR: TIER_CENTS.casual / 100, setupZAR: TIER_SETUP_CENTS.casual / 100, description: 'Casual dining' },
  { id: 'premium', name: 'Premium', monthlyZAR: TIER_CENTS.premium / 100, setupZAR: TIER_SETUP_CENTS.premium / 100, description: 'Premium restaurant' },
  { id: 'signature', name: 'Signature', monthlyZAR: TIER_CENTS.signature / 100, setupZAR: TIER_SETUP_CENTS.signature / 100, description: 'Signature dining' },
  { id: 'group', name: 'Group', monthlyZAR: TIER_CENTS.group / 100, setupZAR: TIER_SETUP_CENTS.group / 100, description: 'Group + R2,500/location' },
];

/**
 * GET /api/billing — current tenant's billing state + available tiers.
 * Super admin additionally sees plan + plan_status per tenant (compact).
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gate = await evaluateBillingGate(tenant.id);
  const superAdmin = await isSuperAdmin();

  return NextResponse.json({
    ok: true,
    billing: {
      plan: tenant.plan ?? 'trial',
      planStatus: tenant.planStatus ?? 'trialing',
      trialEndsAt: tenant.trialEndsAt,
      trialDaysLeft: gate.trialDaysLeft,
      hasSubscription: gate.hasSubscription,
      readOnly: gate.readOnly,
    },
    tiers: TIERS,
    annualDiscount: '2 months free on annual',
    superAdmin,
  });
}
