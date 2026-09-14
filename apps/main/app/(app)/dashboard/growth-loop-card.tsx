'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';

type Opportunity = { id: string; title: string; description: string; confidence: string; opportunityType: string };

export function GrowthLoopCard({ opportunity }: { opportunity: Opportunity | null }) {
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function turnIntoCampaign() {
    if (!opportunity || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/marketing/opportunities/${encodeURIComponent(opportunity.id)}/campaign`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create campaign');
      setCreated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create campaign');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-[28px] border border-black/[0.07] bg-[#111113] p-6 text-white shadow-sm sm:p-7">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
            <Sparkles className="h-4 w-4" /> Revenue → Campaign
          </div>
          {opportunity ? (
            <>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{opportunity.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/55">{opportunity.description}</p>
              <p className="mt-3 text-xs text-white/35">Detected opportunity · {opportunity.opportunityType} · {Math.round(Number(opportunity.confidence) * 100)}% confidence</p>
            </>
          ) : (
            <>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">No new opportunity detected.</h2>
              <p className="mt-2 text-sm leading-6 text-white/55">Flavourly will surface a revenue or market opportunity here when one is available.</p>
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
          {opportunity && !created && (
            <button type="button" onClick={turnIntoCampaign} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? 'Creating draft…' : 'Turn into campaign'}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </button>
          )}
          {created && <span className="rounded-full bg-white/10 px-4 py-3 text-center text-sm font-semibold text-white">Campaign draft created ✓</span>}
          <Link href="/dashboard/marketing/campaigns" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white/75 hover:text-white">
            Open Campaigns <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
      {error && <p className="mt-4 text-xs text-red-300">{error}</p>}
    </section>
  );
}
