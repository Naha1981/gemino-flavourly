import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getBriefHistory } from '@/lib/marketing/brief-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ briefs: await getBriefHistory(tenant.id) });
}