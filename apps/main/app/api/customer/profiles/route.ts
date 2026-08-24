import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  countProfiles,
  listProfiles,
  serializeCustomerProfile,
} from '@/lib/customer/profile-store';
import { normalizeCustomerSegment } from '@/lib/customer/segmentation';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);
  const rawSegment = url.searchParams.get('segment');
  const segment = rawSegment ? normalizeCustomerSegment(rawSegment) : undefined;

  if (rawSegment && !segment) {
    return NextResponse.json({ error: 'Invalid segment filter' }, { status: 400 });
  }

  const [profiles, total] = await Promise.all([
    listProfiles(tenant.id, limit, offset, segment),
    countProfiles(tenant.id, segment),
  ]);

  return NextResponse.json({
    profiles: profiles.map(serializeCustomerProfile),
    pagination: { limit, offset, total },
  });
}
