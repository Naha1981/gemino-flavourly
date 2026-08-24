'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';

/** Gate #17 — one-way "we did this" mark; refreshes the board on success. */
export function MarkAddressedButton({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/market/opportunities/${encodeURIComponent(opportunityId)}`, {
        method: 'PATCH',
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to mark as addressed');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={mark}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
      >
        <Check className="h-3.5 w-3.5" /> {busy ? 'Marking…' : 'Mark as Addressed'}
      </button>
      {error && <span className="ml-2 text-[11px] text-red-400">{error}</span>}
    </div>
  );
}
