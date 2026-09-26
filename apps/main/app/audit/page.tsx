'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2, Radar, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';

interface AuditPayload {
  sourceUrl: string;
  auditedAt: string;
  audit: {
    readinessScore: number;
    readinessLabel: string;
    findings: Array<{
      id: string;
      title: string;
      description: string;
      severity: 'high' | 'medium' | 'low';
      evidence: 'verified' | 'strong_evidence' | 'hypothesis' | 'unknown';
      action: string;
      source: string;
    }>;
    menuPreview: Array<{ name: string; price: string | null; description?: string | null }>;
    evidenceNotes: string[];
    profile: {
      brandName: string;
      tagline: string | null;
      confidence: number;
      hasLogo: boolean;
      hasHours: boolean;
      menuItems: number;
      pricedItems: number;
      describedItems: number;
    };
  };
}

const severityStyles = {
  high: 'border-red-200 bg-red-50 text-red-800',
  medium: 'border-amber-200 bg-amber-50 text-amber-900',
  low: 'border-stone-200 bg-stone-50 text-stone-700',
} as const;

const evidenceLabels = {
  verified: 'Verified',
  strong_evidence: 'Strong evidence',
  hypothesis: 'Hypothesis',
  unknown: 'Unknown',
} as const;

export default function RestaurantAuditPage() {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<AuditPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function runAudit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/public/restaurant-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Audit failed.');
      setResult(payload as AuditPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0] text-[#1b1914]">
      <header className="border-b border-black/5 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="text-sm font-semibold tracking-tight">Flavourly</Link>
          <div className="flex items-center gap-2">
            <Link href="/sign-in" className="rounded-full px-4 py-2 text-sm font-medium text-black/55 hover:text-black">Sign in</Link>
            <Link href="/sign-up" className="rounded-full bg-[#151515] px-4 py-2.5 text-sm font-semibold text-white">Create workspace</Link>
          </div>
        </div>
      </header>

      <main>
        {!result ? (
          <section className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:px-8 sm:pt-24">
            <div className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr]">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-black/55 shadow-sm"><Radar className="h-3.5 w-3.5" />Restaurant Revenue Diagnostic</div>
                <h1 className="mt-6 max-w-2xl text-5xl font-semibold tracking-[-0.06em] sm:text-6xl">Find the leaks your restaurant can actually see.</h1>
                <p className="mt-6 max-w-xl text-lg leading-8 text-black/55">Give Flavourly your restaurant website. We&apos;ll inspect the visible menu, brand signals and customer-facing information and show you the highest-priority issues worth investigating.</p>
                <form onSubmit={runAudit} className="mt-8">
                  <div className="rounded-2xl border border-black/10 bg-white p-2 shadow-xl shadow-black/5">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input type="url" inputMode="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://yourrestaurant.co.za" className="min-w-0 flex-1 rounded-xl bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-black/30" aria-label="Restaurant website" />
                      <button type="submit" disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#151515] px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-50">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                        {loading ? 'Scanning' : 'Run free audit'}
                      </button>
                    </div>
                  </div>
                </form>
                {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  {[['Menu', 'prices, descriptions, structure'], ['Brand', 'metadata, logo, hours'], ['Evidence', 'facts separated from guesses']].map(([title, text]) => (
                    <div key={title} className="rounded-2xl border border-black/5 bg-white p-4"><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-black/45">{text}</p></div>
                  ))}
                </div>
              </div>

              <div className="rounded-[32px] bg-[#151515] p-6 text-white shadow-2xl sm:p-8">
                <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">What the owner sees</p><p className="mt-2 text-2xl font-semibold tracking-tight">Evidence → opportunity → action</p></div><Sparkles className="h-5 w-5 text-white/50" /></div>
                <div className="mt-8 space-y-3">
                  {[['01', 'Observed menu issue', 'Visible items missing useful descriptions'], ['02', 'Commercial mechanism', 'Customers have less information before purchase'], ['03', 'Recommended fix', 'Rewrite priority items and expose pricing consistently'], ['04', 'Verification boundary', 'Revenue impact requires real order / booking data']].map(([n, title, text]) => (
                    <div key={n} className="rounded-2xl border border-white/10 bg-white/[0.05] p-4"><div className="flex gap-4"><span className="text-xs font-bold text-white/30">{n}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-white/50">{text}</p></div></div></div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="mx-auto max-w-6xl px-5 pb-20 pt-12 sm:px-8">
            <div className="flex flex-col gap-4 border-b border-black/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-black/35">Restaurant revenue snapshot</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">{result.audit.profile.brandName}</h1>{result.audit.profile.tagline && <p className="mt-2 max-w-2xl text-sm leading-6 text-black/50">{result.audit.profile.tagline}</p>}</div>
              <button onClick={() => setResult(null)} className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-black/60 hover:text-black">Scan another</button>
            </div>
            <div className="mt-7 grid gap-4 md:grid-cols-4">
              <Kpi label="Readiness" value={result.audit.readinessScore + '/100'} />
              <Kpi label="Menu items" value={String(result.audit.profile.menuItems)} />
              <Kpi label="Priced items" value={String(result.audit.profile.pricedItems)} />
              <Kpi label="Scan confidence" value={Math.round(result.audit.profile.confidence * 100) + '%'} />
            </div>
            <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
              <div className="space-y-4">
                {result.audit.findings.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6"><p className="font-semibold text-emerald-900">No obvious leakage candidates were detected from the visible page.</p><p className="mt-2 text-sm leading-6 text-emerald-800/80">That does not prove the restaurant is fully optimised. Connect order, booking and review data for a stronger commercial diagnosis.</p></div>
                ) : result.audit.findings.map((finding) => (
                  <article key={finding.id} className={'rounded-2xl border p-5 ' + severityStyles[finding.severity]}>
                    <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-current/20 bg-white/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]">{finding.severity}</span><span className="rounded-full border border-current/10 bg-white/30 px-2 py-0.5 text-[10px] font-semibold">{evidenceLabels[finding.evidence]}</span></div>
                    <h2 className="mt-3 text-lg font-semibold">{finding.title}</h2><p className="mt-2 text-sm leading-6 opacity-80">{finding.description}</p>
                    <div className="mt-4 rounded-xl border border-current/10 bg-white/40 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-60">Recommended next action</p><p className="mt-1 text-sm font-medium">{finding.action}</p></div>
                    <p className="mt-3 text-[11px] opacity-55">{finding.source}</p>
                  </article>
                ))}
              </div>
              <aside className="space-y-4">
                <div className="rounded-2xl border border-black/10 bg-white p-5"><p className="text-xs font-bold uppercase tracking-[0.14em] text-black/35">Menu preview</p><div className="mt-4 space-y-2">
                  {result.audit.menuPreview.length === 0 ? <p className="text-sm text-black/45">No menu items were verified on this page.</p> : result.audit.menuPreview.map((item) => <div key={item.name} className="flex items-start justify-between gap-3 border-b border-black/5 pb-2 text-sm last:border-0 last:pb-0"><span className="font-medium">{item.name}</span><span className="shrink-0 text-black/45">{item.price ?? 'Price unknown'}</span></div>)}
                </div></div>
                <div className="rounded-2xl border border-black/10 bg-white p-5"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-black/35"><ShieldCheck className="h-3.5 w-3.5" />Evidence boundary</p><ul className="mt-4 space-y-3">
                  {result.audit.evidenceNotes.map((note) => <li key={note} className="flex gap-2 text-xs leading-5 text-black/55"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{note}</li>)}
                </ul></div>
              </aside>
            </div>
            <div className="mt-10 rounded-[28px] bg-[#151515] p-7 text-white sm:p-9"><div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">Next layer</p><h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Turn this snapshot into a revenue workspace.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">Connect reviews, competitors, enquiries and verified revenue so Flavourly can move from visible leakage candidates to tracked opportunities and measurable interventions.</p></div><Link href="/sign-up" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black">Create workspace <ArrowRight className="h-4 w-4" /></Link></div></div>
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><p>The audit is intentionally evidence-first. A website scan cannot prove revenue loss, customer intent or causation by itself.</p></div></div>
          </section>
        )}
      </main>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-black/35">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p></div>;
}
