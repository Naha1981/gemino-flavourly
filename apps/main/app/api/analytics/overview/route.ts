import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { buildTenantAnalytics } from '@/lib/analytics/aggregate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const analytics = await buildTenantAnalytics(tenant.id).catch(() => null);
  if (!analytics) return NextResponse.json({ overview: { engines: [], generatedAt: new Date().toISOString() } });
  return NextResponse.json({ overview: analytics.overview, forecast: analytics.forecast });
}
