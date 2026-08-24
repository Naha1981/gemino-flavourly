import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { countProfiles, listProfiles } from '@/lib/customer/profile-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const [profiles, total] = await Promise.all([
    listProfiles(tenant.id, limit, offset),
    countProfiles(tenant.id),
  ]);

  return NextResponse.json({
    profiles,
    pagination: { limit, offset, total },
  });
}
