import Link from 'next/link';
import { ArrowRight, CheckCircle2, ExternalLink, Megaphone, ShieldAlert } from 'lucide-react';
import { getOpenPostClient } from '@/lib/autopost/openpost';
import { isDemoModeActive } from '@/lib/demo/demo-mode';

export const dynamic = 'force-dynamic';

export default async function AutoPostPage() {
  const demoMode = await isDemoModeActive();
  const client = getOpenPostClient();
  const workspaceReady = Boolean(process.env.OPENPOST_WORKSPACE_ID?.trim());
  const accountsReady = (process.env.OPENPOST_SOCIAL_ACCOUNT_IDS ?? '').split(',').map((v) => v.trim()).filter(Boolean).length > 0;

  let openPostOnline = false;
  if (client) {
    try {
      await client.health();
      openPostOnline = true;
    } catch {
      openPostOnline = false;
    }
  }

  const liveReady = Boolean(client && workspaceReady && accountsReady && openPostOnline);
  const ready = liveReady || demoMode;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <Megaphone className="h-6 w-6 text-purple-400" />
            <h1 className="text-2xl font-semibold text-zinc-50">AutoPost</h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">Your autonomous content department — review, approve and publish restaurant content.</p>
        </div>
        <Link href="/dashboard/marketing/campaigns" className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500">
          Review campaigns <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className={`rounded-xl border p-5 ${ready ? 'border-emerald-900 bg-emerald-950/20' : 'border-amber-900 bg-amber-950/20'}`}>
        <div className="flex items-start gap-3">
          {ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" /> : <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />}
          <div>
            <p className="font-semibold text-zinc-100">{liveReady ? 'AutoPost is live' : demoMode ? 'Demo AutoPost is ready' : 'AutoPost needs configuration'}</p>
            <p className="mt-1 text-sm text-zinc-400">
              {liveReady
                ? 'Approved campaigns can be sent to the configured OpenPost workspace and connected social accounts.'
                : demoMode
                  ? 'You can demonstrate the complete approval workflow safely. Demo approvals never contact a social network.'
                  : 'Configure OpenPost, its workspace and at least one connected social account before approving a campaign.'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          ['OpenPost service', Boolean(client && openPostOnline)],
          ['Workspace', workspaceReady],
          ['Social accounts', accountsReady],
        ].map(([label, ok]) => (
          <div key={String(label)} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">{label}</p>
            <p className={`mt-3 text-sm font-semibold ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>{ok ? 'Ready' : 'Needs setup'}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="font-semibold text-zinc-100">How approval works</h2>
        <ol className="mt-4 space-y-3 text-sm text-zinc-400">
          <li><span className="mr-2 font-semibold text-zinc-200">1.</span> Flavourly finds a revenue opportunity and creates a campaign draft.</li>
          <li><span className="mr-2 font-semibold text-zinc-200">2.</span> AI/PulseMap helps improve the message and forecasts the likely response.</li>
          <li><span className="mr-2 font-semibold text-zinc-200">3.</span> The restaurant owner reviews it and clicks <strong className="text-zinc-200">Approve & AutoPost</strong>.</li>
          <li><span className="mr-2 font-semibold text-zinc-200">4.</span> OpenPost handles the connected social publishing queue; results flow back into the revenue view.</li>
        </ol>
      </div>

      {client && process.env.OPENPOST_BASE_URL && (
        <a href={process.env.OPENPOST_BASE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-purple-300 hover:text-purple-200">
          Open publishing control centre <ExternalLink className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}
