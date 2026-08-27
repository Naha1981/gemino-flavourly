import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { listManagedTenants } from '@/lib/tenant-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * S4 — GET /api/tenant/list
 *
 * Returns the tenants the signed-in user manages (owned or via membership),
 * oldest first. Used by the sidebar TenantSwitcher's verification and by the
 * E2E suite; returns ids + display names only (no cross-tenant data).
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const managed = await listManagedTenants(userId);
  return NextResponse.json({
    tenants: managed.map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
  });
}
