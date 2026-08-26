import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { ACTIVE_TENANT_COOKIE, canManageTenant, isUuidLike } from '@/lib/tenant-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * S4 — POST /api/tenant/switch { tenantId }
 *
 * Pins the caller's browser to a tenant they manage by setting the
 * `flavourly_active_tenant` cookie. Returns 403 when the caller has no
 * ownership/membership grant on the tenant (and is not a super admin) —
 * this is the enforcement point behind the TenantSwitcher, so a forged or
 * stale tenant id can never become a session across tenants.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let tenantId: unknown = null;
  try {
    const body = await req.json();
    tenantId = body?.tenantId ?? null;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isUuidLike(tenantId as string)) {
    return NextResponse.json({ error: 'tenantId must be a valid tenant id' }, { status: 400 });
  }

  const allowed = await canManageTenant(userId, tenantId as string);
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden: tenant is not managed by this user' }, { status: 403 });
  }

  cookies().set(ACTIVE_TENANT_COOKIE, tenantId as string, {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({
    ok: true,
    tenantId,
    redirect: `/dashboard?tenant=${tenantId}`,
  });
}
