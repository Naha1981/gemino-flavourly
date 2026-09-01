import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { buildTenantAnalytics } from '@/lib/analytics/aggregate';
import { isDemoModeActive } from '@/lib/demo/demo-mode';
import AnalyticsTabs from './analytics-tabs';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  // UI-3R / F2 (S13) — LIVE analytics exclude deadbeef demo rows; Demo Mode
  // ON includes the seed dataset (amber banner + SAMPLE chips render too).
  const demoMode = await isDemoModeActive();
  const analytics = await buildTenantAnalytics(tenant.id, { includeDemoRows: demoMode }).catch(() => null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">Analytics</h1>
        <p className="text-xs text-zinc-400 mt-1">
          Cross-engine performance for your restaurant — revenue, customers, reputation, market and marketing.
        </p>
      </div>
      <AnalyticsTabs data={analytics} demoMode={demoMode} />
    </div>
  );
}
