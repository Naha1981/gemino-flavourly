import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { savePlaceConfig } from '@/lib/reputation/review-store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { placeId, apiKey } = await req.json();
  if (!placeId || !apiKey) return NextResponse.json({ error: 'placeId and apiKey are required' }, { status: 400 });
  return NextResponse.json({ config: await savePlaceConfig(tenant.id, placeId, apiKey) });
}