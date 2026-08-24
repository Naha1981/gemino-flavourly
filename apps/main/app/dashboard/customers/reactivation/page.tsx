import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Send } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { campaignStats, listCampaigns } from '@/lib/customer/reactivation-store';
import { formatResponseRate } from '@/lib/customer/reactivation';
import SendCampaignForm from './send-campaign-client';

export const dynamic = 'force-dynamic';

function formatDateTime(value: Date | string | null): string {
  if (!value) return 'Pending';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Pending';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function SegmentBadge({ segment }: { segment: string }) {
  const dormant = segment === 'dormant';
  return (
    <span
      title={`${dormant ? 'Dormant' : 'At-risk'} reactivation segment`}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        dormant
          ? 'border-zinc-700 bg-zinc-800/80 text-zinc-400'
          : 'border-orange-800/70 bg-orange-950/60 text-orange-300'
      }`}
    >
      {dormant ? 'Dormant' : 'At-risk'}
    </span>
  );
}

export default async function ReactivationPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const [stats, campaigns] = await Promise.all([
    campaignStats(tenant.id),
    listCampaigns(tenant.id, 200, 0),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
            <Send className="h-5 w-5 text-emerald-400" />
            Reactivation campaigns
          </h1>
          <p className="text-xs text-zinc-400">
            Win-back messages to dormant (180+ days) and at-risk (120–180 days) customers · daily
            10:00 send · 90-day anti-spam cooldown
          </p>
        </div>
        <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/40 px-4 py-2 text-sm font-medium text-emerald-300">
          {formatResponseRate(stats.sent, stats.responded)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Campaigns" value={String(stats.total)} />
        <Stat label="Sent" value={String(stats.sent)} />
        <Stat label="Pending" value={String(stats.pending)} />
        <Stat label="Responded" value={String(stats.responded)} />
      </div>

      <SendCampaignForm />

      <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/70">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Segment</th>
              <th className="px-4 py-3 font-medium">Message</th>
              <th className="px-4 py-3 font-medium">Sent</th>
              <th className="px-4 py-3 font-medium">Responded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/80">
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-xs text-zinc-500">
                  No reactivation campaigns yet. The daily cron (10:00) sends them automatically, or
                  use the form above to send one now.
                </td>
              </tr>
            ) : (
              campaigns.map((campaign) => (
                <tr key={campaign.id} className="align-top hover:bg-zinc-800/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/customers/${encodeURIComponent(campaign.customerPhone)}`}
                      className="font-medium text-zinc-100 hover:text-emerald-400"
                    >
                      {campaign.customerName || 'Guest'}
                    </Link>
                    <div className="font-mono text-[11px] text-zinc-500">{campaign.customerPhone}</div>
                  </td>
                  <td className="px-4 py-3">
                    <SegmentBadge segment={campaign.segment} />
                  </td>
                  <td className="max-w-md px-4 py-3 text-xs leading-relaxed text-zinc-300">
                    {campaign.messageText}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">
                    {formatDateTime(campaign.sentAt)}
                  </td>
                  <td className="px-4 py-3">
                    {campaign.responded ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-800/70 bg-emerald-950/60 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                        Responded
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-500">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-50">{value}</p>
    </div>
  );
}
