import { FileText } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { getBriefHistory, getLatestBrief } from '@/lib/marketing/brief-store';
import { GenerateBriefButton } from './generate-button';

export const dynamic = 'force-dynamic';

export default async function MarketingPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');
  const [latest, history] = await Promise.all([getLatestBrief(tenant.id), getBriefHistory(tenant.id)]);
  const brief = latest?.brief as { summary?: string; ideas?: Array<{ topic: string; audience: string; message: string; cta: string; visual: string }> } | undefined;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
        <FileText className="h-5 w-5 text-emerald-400" />
        <div><h1 className="text-xl font-semibold text-zinc-50">Marketing</h1><p className="text-xs text-zinc-400">Your latest content brief and ideas.</p></div><span className="ml-auto"><GenerateBriefButton /></span>
      </div>
      {!brief ? <p className="rounded-lg border border-dashed border-zinc-800 p-8 text-sm text-zinc-400">No brief generated yet. The daily brief will appear here at 7am.</p> : <>
        <section className="space-y-4"><p className="text-sm text-zinc-300">{brief.summary}</p>
          <div className="grid gap-3 lg:grid-cols-2">{(brief.ideas ?? []).map((idea) => <article key={idea.topic} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"><h2 className="font-medium text-zinc-100">{idea.topic}</h2><p className="mt-2 text-sm text-zinc-300">{idea.message}</p><p className="mt-3 text-xs text-zinc-500">Audience: {idea.audience}</p><p className="mt-1 text-xs text-emerald-300">CTA: {idea.cta}</p><p className="mt-1 text-xs text-zinc-500">Visual: {idea.visual}</p></article>)}</div>
        </section>
        <section><h2 className="mb-3 text-sm font-medium text-zinc-200">Brief history</h2><div className="space-y-2">{history.map((row) => <div key={row.id} className="flex justify-between border-b border-zinc-800 py-2 text-xs text-zinc-400"><span>{new Date(row.generatedAt).toISOString().slice(0, 10)}</span><span>{(row.brief as { ideas?: unknown[] }).ideas?.length ?? 0} ideas</span></div>)}</div></section>
      </>}
    </div>
  );
}