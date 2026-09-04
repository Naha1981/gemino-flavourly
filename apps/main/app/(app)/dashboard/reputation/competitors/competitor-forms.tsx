'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';

/**
 * Gate #14 — Add Competitor + Delete Competitor controls. Both hit the
 * tenant-scoped /api/reputation/competitors endpoints and refresh the
 * server-rendered list.
 */
export function AddCompetitorForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/reputation/competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, place_id: placeId }),
      });
      if (res.ok) {
        setName('');
        setPlaceId('');
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to add competitor');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
      <p className="mb-3 flex items-center gap-2 text-xs font-medium text-app-muted">
        <Plus className="h-3.5 w-3.5 text-emerald-400" /> Track a competitor
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Competitor name (e.g. The Bull Pen)"
          className="flex-1 rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-fg placeholder:text-app-faint focus:border-emerald-600 focus:outline-none"
        />
        <input
          type="text"
          required
          value={placeId}
          onChange={(e) => setPlaceId(e.target.value)}
          placeholder="Google Place ID (ChIJ…)"
          className="flex-1 rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-fg placeholder:text-app-faint focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </form>
  );
}

export function DeleteCompetitorButton({ competitorId, competitorName }: { competitorId: string; competitorName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`Stop tracking ${competitorName}? Its rating history is removed too.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/reputation/competitors/${encodeURIComponent(competitorId)}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className="inline-flex items-center gap-1 text-red-400 hover:text-red-300 disabled:opacity-50"
    >
      <Trash2 className="h-3 w-3" /> {busy ? 'Removing…' : 'Remove'}
    </button>
  );
}
