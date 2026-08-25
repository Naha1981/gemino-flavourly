import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * GET /api/onboarding — onboarding state for the current tenant.
 */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenant.id)).limit(1);
  return NextResponse.json({
    ok: true,
    onboardingComplete: t?.onboardingComplete ?? false,
    profile: {
      name: t?.name ?? '',
      description: t?.description ?? '',
      openingHours: t?.openingHours ?? '',
      address: t?.address ?? '',
      menuText: t?.menuText ?? '',
    },
  });
}

/**
 * POST /api/onboarding — save a wizard step and/or mark onboarding complete.
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

  const complete = body.complete === true;

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  // Step 1: restaurant profile fields.
  for (const key of ['name', 'description', 'openingHours', 'address', 'menuText'] as const) {
    if (typeof body[key] === 'string') patch[key] = body[key];
  }

  if (complete) {
    patch.onboardingComplete = true;
  }

  try {
    const [updated] = await db.update(tenants).set(patch).where(eq(tenants.id, tenant.id)).returning();
    return NextResponse.json({ ok: true, onboardingComplete: updated.onboardingComplete });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to save onboarding' }, { status: 500 });
  }
}
