import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { buildTenantAnalytics, findSummary } from '@/lib/analytics/aggregate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const analytics = await buildTenantAnalytics(tenant.id).catch(() => null);
  if (!analytics) return NextResponse.json({ summary: null, forecast: null, series: [] });
  return NextResponse.json({
    summary: findSummary(analytics, 'revenue') ?? null,
    forecast: analytics.forecast,
    series: analytics.series.revenue,
  });
}
