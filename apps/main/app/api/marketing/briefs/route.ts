import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getLatestBrief } from '@/lib/marketing/brief-store';
import { saveBrief } from '@/lib/marketing/brief-store';
import { generateDailyBrief } from '@/lib/marketing/brief-generator';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const brief = await getLatestBrief(tenant.id);
  return NextResponse.json({ brief });
}

export async function POST() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const brief = await saveBrief(tenant.id, generateDailyBrief({ restaurantName: tenant.name }));
  return NextResponse.json({ brief }, { status: 201 });
}