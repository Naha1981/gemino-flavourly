import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { buildTenantAnalytics } from '@/lib/analytics/aggregate';
import AnalyticsTabs from './analytics-tabs';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const analytics = await buildTenantAnalytics(tenant.id).catch(() => null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-fg tracking-tight">Analytics</h1>
        <p className="text-xs text-app-muted mt-1">
          Cross-engine performance for your restaurant — revenue, customers, reputation, market and marketing.
        </p>
      </div>
      <AnalyticsTabs data={analytics} />
    </div>
  );
}
