'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Radar } from 'lucide-react';

/** Gate #17 — the two controls on the opportunities page. */

export function AnalyzeMarketButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/market/opportunities/analyze', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Analysis failed');
        return;
      }
      setResult(
        `Analysed ${data.competitors_analysed} competitor${data.competitors_analysed === 1 ? '' : 's'} — ` +
          `${data.opportunities?.length ?? 0} gap${data.opportunities?.length === 1 ? '' : 's'} found.`
      );
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <p className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-100">
        <Radar className="h-4 w-4 text-emerald-400" /> Re-run the analysis
      </p>
      <p className="mb-3 text-xs text-zinc-500">
        Reads the competitors you track and their latest menu snapshots. No external calls, so it is safe to run any
        time — the daily 8am sweep does it anyway.
      </p>
      <button
        type="button"
        onClick={analyze}
        disabled={busy}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? 'Analysing…' : 'Analyse market now'}
      </button>
      {result && <p className="mt-2 text-xs text-emerald-300">{result}</p>}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function MarkAddressedButton({
  opportunityId,
  title,
  addressed,
}: {
  opportunityId: string;
  title: string;
  addressed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await fetch(`/api/market/opportunities/${encodeURIComponent(opportunityId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addressed: !addressed }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
        addressed
          ? 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
          : 'border-emerald-800 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/40'
      }`}
    >
      <CheckCircle2 className="h-3 w-3" />
      {busy ? 'Saving…' : addressed ? 'Addressed — undo' : 'Mark as addressed'}
    </button>
  );
}
