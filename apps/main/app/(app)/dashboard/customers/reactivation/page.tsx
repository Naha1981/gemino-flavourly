import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MessageSquareHeart, CheckCircle2, Clock } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { campaignStats, listCampaigns } from '@/lib/customer/reactivation-store';
import ReactivationClient from './reactivation-client';

export const dynamic = 'force-dynamic';

type ReactivationPageProps = {
  searchParams?: { segment?: string | string[] };
};

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Gate #9 — reactivation campaign dashboard.
 *
 * Server-rendered list of every win-back campaign for this tenant, the
 * response-rate headline ("24 sent, 8 responded (33%)"), and a manual send
 * form (client component) for a specific customer.
 */
export default async function ReactivationPage(_props: ReactivationPageProps) {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const [stats, campaigns] = await Promise.all([campaignStats(tenant.id), listCampaigns(tenant.id, 100, 0)]);
  const responsePercent = stats.sent > 0 ? Math.round((stats.responded / stats.sent) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-app-border pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-app-fg">
            <MessageSquareHeart className="h-5 w-5 text-emerald-400" />
            Reactivation Campaigns
          </h1>
          <p className="text-xs text-app-muted">
            Win-back messages to dormant (180+ days) and at-risk (120–180 days) customers · daily cron at 10:00
          </p>
        </div>
        <Link
          href="/dashboard/customers"
          className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
        >
          ← All customers
        </Link>
      </div>

      {/* Headline metrics */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-app-border bg-app-surface-0/70 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-app-faint">Response rate</div>
          <div className="mt-1 text-sm font-semibold text-app-fg">
            {stats.sent} sent, {stats.responded} responded ({responsePercent}%)
          </div>
        </div>
        <div className="rounded-lg border border-app-border bg-app-surface-0/70 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-app-faint">Pending dispatch</div>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-app-fg">
            <Clock className="h-4 w-4 text-amber-400" />
            {stats.pending}
          </div>
        </div>
        <div className="rounded-lg border border-app-border bg-app-surface-0/70 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-app-faint">Total campaigns</div>
          <div className="mt-1 text-sm font-semibold text-app-fg">{stats.total}</div>
        </div>
      </div>

      {/* Manual send */}
      <div className="rounded-lg border border-app-border bg-app-surface-0/70 p-4">
        <h2 className="mb-1 text-sm font-medium text-app-fg">Send a campaign manually</h2>
        <p className="mb-3 text-xs text-app-faint">
          Uses the same eligibility rules as the cron. Customers who received a campaign in the last 90 days need an
          explicit override; opted-out customers (POPIA) can never be messaged.
        </p>
        <ReactivationClient />
      </div>

      {/* Campaign list */}
      <div className="overflow-hidden rounded-lg border border-app-border bg-app-surface-0/70">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-app-border text-xs uppercase tracking-wide text-app-faint">
            <tr>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Segment</th>
              <th className="px-4 py-3 font-medium">Message</th>
              <th className="px-4 py-3 font-medium">Sent</th>
              <th className="px-4 py-3 font-medium">Responded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border/80">
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-xs text-app-faint">
                  No reactivation campaigns yet. The daily cron sends to dormant and at-risk customers; you can also
                  send one manually above.
                </td>
              </tr>
            ) : (
              campaigns.map((campaign) => (
                <tr key={campaign.id} className="align-top hover:bg-app-surface-1/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/customers/${encodeURIComponent(campaign.customerPhone)}`}
                      className="font-medium text-app-fg hover:text-emerald-400"
                    >
                      {campaign.customerName || 'Guest'}
                    </Link>
                    <div className="font-mono text-[11px] text-app-faint">{campaign.customerPhone}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      title={`${campaign.segment} segment`}
                      className={
                        campaign.segment === 'dormant'
                          ? 'inline-flex items-center rounded-full border border-app-border-strong bg-app-surface-1/80 px-2 py-0.5 text-[10px] font-medium text-app-muted'
                          : 'inline-flex items-center rounded-full border border-orange-800/70 bg-orange-950/60 px-2 py-0.5 text-[10px] font-medium text-orange-300'
                      }
                    >
                      {campaign.segment === 'dormant' ? 'Dormant' : 'At-risk'}
                    </span>
                    <div className="mt-1 text-[11px] text-app-faint">created {formatDate(campaign.createdAt)}</div>
                  </td>
                  <td className="max-w-md px-4 py-3 text-xs text-app-muted">{campaign.messageText}</td>
                  <td className="px-4 py-3 text-xs text-app-muted">{formatDate(campaign.sentAt)}</td>
                  <td className="px-4 py-3">
                    {campaign.responded ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Yes
                      </span>
                    ) : (
                      <span className="text-xs text-app-faint">{campaign.sentAt ? 'No' : 'Pending'}</span>
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
