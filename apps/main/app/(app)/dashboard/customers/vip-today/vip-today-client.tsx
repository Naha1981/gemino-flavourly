'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, StickyNote, Star } from 'lucide-react';

interface VipTodayAlert {
  id: string;
  customerName: string | null;
  customerPhone: string;
  totalVisits: number;
  totalSpendCents: number;
  preferences?: Record<string, string[]>;
  lastVisitAt?: string | null;
  sentAt?: string | null;
  servedAt?: string | null;
  note?: string | null;
}

function formatCents(cents: number): string {
  return `R${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

export default function VipTodayClient({ alerts }: { alerts: VipTodayAlert[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/customer/vip-alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? 'Failed to update VIP alert');
    }
  }

  async function markServed(id: string) {
    setBusyId(id);
    try {
      await patch(id, { served: true });
      router.refresh();
    } catch (err) {
      console.error('[VIP] Failed to mark served', err);
    } finally {
      setBusyId(null);
    }
  }

  async function saveNote(id: string) {
    const note = (notes[id] ?? '').trim();
    if (!note) return;
    setBusyId(id);
    try {
      await patch(id, { note });
      setNotes((prev) => ({ ...prev, [id]: '' }));
      router.refresh();
    } catch (err) {
      console.error('[VIP] Failed to add note', err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {alerts.map((alert) => {
        const served = Boolean(alert.servedAt);
        const prefs = alert.preferences ?? {};
        const dietary = Array.isArray(prefs.dietary) ? prefs.dietary.join(', ') : '';
        const favorites = Array.isArray(prefs.favorites) ? prefs.favorites.join(', ') : '';
        return (
          <div
            key={alert.id}
            className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-4 hover:border-amber-600/60 transition-colors"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <Link
                    href={`/dashboard/customers/${encodeURIComponent(alert.customerPhone)}`}
                    className="font-semibold text-zinc-50 hover:text-amber-300"
                  >
                    {alert.customerName || 'Guest'}
                  </Link>
                  {served && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-800 bg-emerald-950/60 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Served
                    </span>
                  )}
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{alert.customerPhone}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-300">
                  <span>{alert.totalVisits} visits</span>
                  <span>{formatCents(alert.totalSpendCents)} spend</span>
                  <span>Last visit {formatDate(alert.lastVisitAt)}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {dietary && <span>Dietary: {dietary} · </span>}
                  {favorites && <span>Favorite: {favorites} · </span>}
                  {alert.note && <span className="text-amber-300/80">Note: {alert.note}</span>}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => markServed(alert.id)}
                  disabled={served || busyId === alert.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-800 bg-emerald-950/50 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/50 disabled:opacity-40"
                >
                  {busyId === alert.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {served ? 'Served' : 'Mark as served'}
                </button>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveNote(alert.id);
              }}
              className="mt-3 flex items-center gap-2"
            >
              <StickyNote className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <input
                type="text"
                value={notes[alert.id] ?? ''}
                onChange={(e) => setNotes((prev) => ({ ...prev, [alert.id]: e.target.value }))}
                placeholder="Add a note..."
                className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busyId === alert.id || !(notes[alert.id] ?? '').trim()}
                className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
              >
                Add note
              </button>
            </form>
          </div>
        );
      })}
    </div>
  );
}
