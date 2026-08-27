'use client';

import { useState } from 'react';
import { Database, Loader2, Trash2 } from 'lucide-react';

/**
 * Demo Mode controls (Super Admin, /admin): one-click Load / Wipe of the
 * busy-restaurant seed dataset. Wipe asks for confirmation; both actions
 * report counts via toast. The dataset only ever contains deadbeef-prefixed
 * rows — real data is never modified or deleted.
 */
export function DemoControls({ initialActive }: { initialActive: boolean }) {
  const [busy, setBusy] = useState<'load' | 'wipe' | null>(null);
  const [active, setActive] = useState(initialActive);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  function notify(kind: 'success' | 'error', text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 8000);
  }

  async function load() {
    setBusy('load');
    try {
      const res = await fetch('/api/admin/seed-demo', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        notify('error', data.error || 'Seed failed.');
        return;
      }
      setActive(true);
      const total = Object.values((data.counts ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);
      notify(
        'success',
        `Demo data loaded: ${data.tenantName} + 6 platform tenants (${total} rows).${data.ownerLinked ? '' : ' Owner link skipped (no CLERK_SECRET_KEY).'}`
      );
    } catch {
      notify('error', 'Seed failed — network error.');
    } finally {
      setBusy(null);
    }
  }

  async function wipe() {
    if (!window.confirm('Wipe ALL demo data? Only deadbeef-prefixed demo rows are deleted — real data is never touched.')) {
      return;
    }
    setBusy('wipe');
    try {
      const res = await fetch('/api/admin/wipe-demo', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        notify('error', data.error || 'Wipe failed.');
        return;
      }
      setActive(false);
      notify('success', 'Demo data wiped — clean slate for real pilots.');
    } catch {
      notify('error', 'Wipe failed — network error.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-app-border bg-app-surface-0 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-app-primary-container text-app-on-primary-container dark:bg-zinc-800 dark:text-stitch-gold">
          <Database className="h-5 w-5" />
        </span>
        <div>
          <h2 className="headline-md text-app-fg dark:text-zinc-50">Demo Mode</h2>
          <p className="mt-1 text-sm text-app-muted dark:text-zinc-400">
            Load a busy-restaurant dataset (The Grand Bistro + 6 tenants) for screenshots and demo
            videos. Safe by design: seeded rows are <code className="text-xs">deadbeef-…</code> ids;
            wipe deletes only those.{' '}
            {active && (
              <span className="label-sm ml-1 rounded-full bg-app-secondary-container px-2 py-0.5 text-app-on-secondary-container dark:bg-zinc-800 dark:text-emerald-300">
                demo data active
              </span>
            )}
          </p>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          className={`mt-4 rounded-lg border px-4 py-2.5 text-sm ${
            toast.kind === 'success'
              ? 'border-app-secondary-container bg-app-secondary-container/40 text-app-on-secondary-container dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-app-error-container bg-app-error-container/40 text-app-error dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={load}
          disabled={busy !== null}
          data-testid="demo-load-button"
          className="inline-flex items-center gap-2 rounded-lg bg-app-secondary px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-emerald-600"
        >
          {busy === 'load' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          Load Demo Data
        </button>
        <button
          type="button"
          onClick={wipe}
          disabled={busy !== null}
          data-testid="demo-wipe-button"
          className="inline-flex items-center gap-2 rounded-lg border border-app-error/50 bg-transparent px-5 py-2.5 text-sm font-semibold text-app-error hover:bg-app-error-container/40 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          {busy === 'wipe' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Wipe Demo Data
        </button>
      </div>
    </section>
  );
}
