'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Radar, Trash2 } from 'lucide-react';

/**
 * Gates #15-#16 — the client-side controls on the Market Intelligence page.
 *
 * They are thin: each one calls a tenant-scoped API route and then refreshes
 * the server-rendered page, so there is exactly one source of truth for what
 * is on screen.
 */

interface DiscoverySummary {
  found: number;
  added: number;
  skipped_existing: number;
  radius_km: number;
  origin: { address: string | null };
}

export function DiscoverCompetitorsButton({ hasStoredAddress }: { hasStoredAddress: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState('');
  const [summary, setSummary] = useState<DiscoverySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function discover() {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch('/api/market/competitors/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(address.trim() ? { address: address.trim() } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Discovery failed');
        return;
      }
      setSummary(data as DiscoverySummary);
      setAddress('');
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
        <Radar className="h-4 w-4 text-emerald-400" /> Discover competitors nearby
      </p>
      <p className="mb-3 text-xs text-zinc-500">
        {hasStoredAddress
          ? 'Searches every restaurant within 5km of the address saved in Settings.'
          : 'No address on file yet — type one below, or save it in Settings to make this one click.'}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={hasStoredAddress ? 'Override address (optional)' : '12 Loop St, Cape Town'}
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={discover}
          disabled={busy}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Searching…' : 'Discover Competitors'}
        </button>
      </div>
      {summary && (
        <p className="mt-2 text-xs text-emerald-300">
          Found {summary.found} restaurant{summary.found === 1 ? '' : 's'} within {summary.radius_km}km of{' '}
          {summary.origin.address ?? 'your address'} — added {summary.added}
          {summary.skipped_existing > 0 ? `, skipped ${summary.skipped_existing} already tracked` : ''}.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function AddCompetitorManuallyForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
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
        body: JSON.stringify({ name, address, website_url: website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to add competitor');
        return;
      }
      setName('');
      setAddress('');
      setWebsite('');
      router.refresh();
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
      <div className="flex flex-col gap-2 lg:flex-row">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Competitor name *"
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
        />
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address (optional)"
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
        />
        <input
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://their-site.com (optional)"
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </form>
  );
}

/**
 * Removes a competitor. Reuses the Gate #14 DELETE endpoint on purpose: it is
 * the same `competitors` table, already tenant-scoped and already covered by
 * the reputation wiring tests, and a second delete path would be a second
 * place to get isolation wrong.
 */
export function RemoveCompetitorButton({ competitorId, competitorName }: { competitorId: string; competitorName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`Stop tracking ${competitorName}? Its menu history and promotions are removed too.`)) return;
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
