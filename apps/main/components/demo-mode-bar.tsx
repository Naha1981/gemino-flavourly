'use client';

import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

export function DemoModeBar({ active }: { active: boolean }) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  function notify(kind: 'info' | 'error', text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 6000);
  }

  async function flip() {
    setBusy(true);
    try {
      if (!active) {
        try {
          const res = await fetch('/api/admin/demo-view', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: true }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.success) {
            notify('info', data.seeded ? `Demo data loaded (${data.tenantName}) — switching view to Demo.` : 'Demo dataset already loaded — switching view to Demo.');
          } else {
            notify('error', data.error || 'Could not load demo data — switching view anyway.');
          }
        } catch {
          notify('error', 'Demo data route unreachable — switching view with existing data.');
        }
        document.cookie = 'gemino_demo_mode=on; path=/; max-age=31536000; samesite=lax';
      } else {
        document.cookie = 'gemino_demo_mode=; path=/; max-age=0; samesite=lax';
      }

      window.location.reload();
    } catch {
      setBusy(false);
    }
  }

  if (active) {
    return (
      <div role="status" data-testid="demo-mode-banner" className="sticky top-0 z-50 w-full border-b border-amber-600/60 bg-amber-500/10 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2.5 text-amber-300">
            <Eye className="h-4 w-4 shrink-0" aria-hidden />
            <p className="text-xs font-semibold tracking-wide">DEMO DATA — you are viewing deterministic seed data. Your live database is untouched.</p>
          </div>
          <div className="flex items-center gap-3">
            {toast && <span role="status" className="text-xs text-amber-200/80">{toast.text}</span>}
            <button type="button" onClick={flip} disabled={busy} data-testid="demo-mode-toggle" className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/30 disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
              Switch to Live Data
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {toast && <span role="status" className="text-xs text-amber-500/90">{toast.text}</span>}
      <button type="button" onClick={flip} disabled={busy} data-testid="demo-mode-toggle" className="inline-flex items-center gap-1.5 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-900/40 disabled:opacity-60">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
        Demo Mode
      </button>
    </span>
  );
}
