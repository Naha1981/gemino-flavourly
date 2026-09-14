'use client';

import { useState } from 'react';
import { CheckCheck, Loader2 } from 'lucide-react';

export function AdminNotificationsMarkReadButton({ unreadCount }: { unreadCount: number }) {
  const [busy, setBusy] = useState(false);

  async function markRead() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/admin/notifications/mark-read', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) {
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={markRead}
      disabled={busy}
      data-testid="qa-notifications-mark-read"
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
      Mark all read ({unreadCount})
    </button>
  );
}
