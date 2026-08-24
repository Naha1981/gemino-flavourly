'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Radar, Plus } from 'lucide-react';

/**
 * Gate #15 — discovery trigger + manual add. Discovery hits
 * /api/market/competitors/discover and reports exactly what the platform
 * found; manual add posts the trimmed fields to the list endpoint.
 */
export function DiscoverCompetitorsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function discover() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/market/competitors/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radius_km: 5 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Discovery failed (${res.status})`);
        return;
      }
      setMessage(
        `Found ${data.found} restaurants within ${data.radius_km}km — ${data.new_competitors} newly tracked, ${data.updated} refreshed.`
      );
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={discover}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        <Radar className={`h-4 w-4 ${busy ? 'animate-pulse' : ''}`} />
        {busy ? 'Scanning 5km…' : 'Discover Competitors'}
      </button>
      {message && <p className="mt-1.5 text-[11px] text-emerald-400">{message}</p>}
      {error && <p className="mt-1.5 max-w-xs text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

export function AddCompetitorForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', address: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/market/competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setForm({ name: '', address: '', website: '' });
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
    <form onSubmit={submit} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <p className="mb-3 flex items-center gap-2 text-xs font-medium text-zinc-300">
        <Plus className="h-3.5 w-3.5 text-emerald-400" /> Add manually
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Name *"
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
        />
        <input
          type="text"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          placeholder="Address"
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
        />
        <input
          type="text"
          value={form.website}
          onChange={(e) => setForm({ ...form, website: e.target.value })}
          placeholder="https://their-menu.co.za"
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </form>
  );
}
