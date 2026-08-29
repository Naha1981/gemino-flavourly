import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { listMarketingCampaigns } from '@/lib/marketing/campaign-store';

export const dynamic = 'force-dynamic';

export default async function MarketingCampaignsPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const campaigns = await listMarketingCampaigns(tenant.id);

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

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-4">
        <h1 className="text-xl font-semibold text-zinc-50">Marketing Campaigns</h1>
        <p className="text-xs text-zinc-400">
          {campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}. Create promotions, events, and announcements.
        </p>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-400">
          No marketing campaigns yet. Create your first campaign to start engaging customers.
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-zinc-100">{campaign.name}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${typeColors[campaign.type] ?? typeColors.custom}`}>
                  {campaign.type}
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${statusColors[campaign.status] ?? statusColors.draft}`}>
                  {campaign.status}
                </span>
                {campaign.offer && (
                  <span className="text-xs text-amber-300">{campaign.offer}</span>
                )}
              </div>
              {campaign.description && (
                <p className="mt-2 text-xs text-zinc-400">{campaign.description}</p>
              )}
              <p className="mt-2 text-sm text-zinc-300">{campaign.message}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
                {campaign.startDate && <span>Starts: {new Date(campaign.startDate).toLocaleDateString()}</span>}
                {campaign.endDate && <span>Ends: {new Date(campaign.endDate).toLocaleDateString()}</span>}
                {campaign.estimatedReach && <span>Est. reach: {campaign.estimatedReach}</span>}
                {campaign.sentCount && campaign.sentCount > 0 && <span>Sent: {campaign.sentCount}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
