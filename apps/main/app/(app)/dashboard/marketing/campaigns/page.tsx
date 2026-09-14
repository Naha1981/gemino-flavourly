import { redirect } from 'next/navigation';
import { Megaphone, Wand2 } from 'lucide-react';
import { resolveActiveTenant } from '@/lib/tenant-resolver';
import { isDemoModeActive } from '@/lib/demo/demo-mode';
import { listMarketingCampaigns } from '@/lib/marketing/campaign-store';
import { getCampaignAttributionSummary, reconcileCampaignAttribution } from '@/lib/marketing/attribution-store';
import { latestSimulationsByCampaign, type SimulationWithSegments } from '@/lib/pulsemap/store';
import { CampaignBuilder, type BuilderCampaign } from './campaign-builder';

export const dynamic = 'force-dynamic';

export default async function MarketingCampaignsPage({
  searchParams,
}: {
  searchParams?: { tenant?: string };
}) {
  const resolved = await resolveActiveTenant();
  if (!resolved) redirect('/sign-in');
  const tenant = resolved.tenant;

  const tenantParam = searchParams?.tenant ?? null;
  const demoMode = await isDemoModeActive();
  const [campaigns, simulationsByCampaign] = await Promise.all([
    listMarketingCampaigns(tenant.id).catch(() => []),
    latestSimulationsByCampaign(tenant.id, demoMode ? { includeDemoRows: true } : {}).catch(
      () => new Map<string, SimulationWithSegments>(),
    ),
  ]);

  const reconciled = await reconcileCampaignAttribution(tenant.id).catch(() => []);
  const attribution = new Map(reconciled.map((row) => [row.campaignId, row]));

  // Ensure campaigns that have no completed send yet still render a stable
  // zero-valued attribution shape.
  const missing = await Promise.all(
    campaigns
      .filter((campaign) => !attribution.has(campaign.id))
      .map(async (campaign) => [campaign.id, await getCampaignAttributionSummary(tenant.id, campaign.id)] as const),
  );
  for (const [campaignId, summary] of missing) attribution.set(campaignId, summary);

  const draftCampaigns: BuilderCampaign[] = campaigns
    .filter((c) => c.status === 'draft')
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      offer: c.offer,
      message: c.message,
      targetSegment: c.targetSegment,
      startDate: c.startDate ? new Date(c.startDate).toISOString() : null,
      status: c.status,
    }));

  const typeColors: Record<string, string> = {
    promotion: 'bg-emerald-950 text-emerald-300',
    event: 'bg-blue-950 text-blue-300',
    seasonal: 'bg-amber-950 text-amber-300',
    announcement: 'bg-purple-950 text-purple-300',
    custom: 'bg-zinc-800 text-zinc-300',
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-zinc-800 text-zinc-300',
    scheduled: 'bg-blue-950 text-blue-300',
    sent: 'bg-emerald-950 text-emerald-300',
    failed: 'bg-red-950 text-red-300',
  };

  const readableStatus = (status: string): string => {
    if (status === 'sent') return 'launched';
    if (status === 'draft') return 'draft';
    return status;
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
          <Megaphone className="h-5 w-5 text-app-secondary dark:text-emerald-400" />
          <div>
            <h1 className="text-xl font-semibold text-zinc-50">Marketing Campaigns</h1>
            <p className="text-xs text-zinc-400">
              {campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}. Create promotions, events, and announcements.
            </p>
          </div>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
          <Wand2 className="h-3.5 w-3.5 text-emerald-400" />
          PulseMap: simulate how your segments react before you send.{' '}
          <span className="text-amber-300">Forecast only. Real results are measured after launch.</span>
        </p>
      </div>

      <CampaignBuilder draftCampaigns={draftCampaigns} demoMode={demoMode} tenantParam={tenantParam} />

      <h2 className="text-sm font-semibold text-zinc-300">All campaigns</h2>
      {campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-400">
          No marketing campaigns yet. Draft your first campaign above — simulate it, improve it, then launch.
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const sim = simulationsByCampaign.get(campaign.id);
            const result = attribution.get(campaign.id);
            return (
              <div key={campaign.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-100">{campaign.name}</span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${typeColors[campaign.type] ?? typeColors.custom}`}>
                    {campaign.type}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${statusColors[campaign.status] ?? statusColors.draft}`}>
                    {readableStatus(campaign.status)}
                  </span>
                  {campaign.offer && <span className="text-xs text-amber-300">{campaign.offer}</span>}
                  {sim && sim.status === 'complete' && typeof sim.score === 'number' && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                        sim.readiness === 'ready'
                          ? 'bg-emerald-950 text-emerald-300'
                          : sim.readiness === 'improve'
                            ? 'bg-amber-950 text-amber-300'
                            : 'bg-red-950 text-red-300'
                      }`}
                      title={sim.explanation ?? 'PulseMap forecast'}
                    >
                      <Wand2 className="h-3 w-3" /> PulseMap {sim.score}/100{sim.appliedAt ? ' · applied' : ''}
                    </span>
                  )}
                </div>
                {campaign.description && <p className="mt-2 text-xs text-zinc-400">{campaign.description}</p>}
                <p className="mt-2 text-sm text-zinc-300">{campaign.message}</p>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-2"><span className="text-zinc-500">Sent</span><strong className="ml-2 text-zinc-200">{result?.sent ?? campaign.sentCount ?? 0}</strong></div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-2"><span className="text-zinc-500">Responded</span><strong className="ml-2 text-zinc-200">{result?.responded ?? 0}</strong></div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-2"><span className="text-zinc-500">Booked</span><strong className="ml-2 text-zinc-200">{result?.booked ?? 0}</strong></div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-2"><span className="text-zinc-500">Estimated value</span><strong className="ml-2 text-emerald-300">R{Math.round((result?.estimatedRevenueCents ?? 0) / 100).toLocaleString('en-ZA')}</strong></div>
                </div>
                {(result?.realizedRevenueCents ?? 0) > 0 && (
                  <p className="mt-2 text-xs text-emerald-300">Verified realised revenue: R{Math.round((result?.realizedRevenueCents ?? 0) / 100).toLocaleString('en-ZA')}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
                  {campaign.startDate && <span>Starts: {new Date(campaign.startDate).toLocaleDateString()}</span>}
                  {campaign.endDate && <span>Ends: {new Date(campaign.endDate).toLocaleDateString()}</span>}
                  {campaign.estimatedReach && <span>Est. reach: {campaign.estimatedReach}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
