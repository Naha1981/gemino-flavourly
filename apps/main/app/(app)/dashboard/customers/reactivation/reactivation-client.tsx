'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';

/**
 * Gate #9 — manual reactivation send form.
 *
 * Posts to /api/customer/reactivation and refreshes the server-rendered
 * campaign list. A 409 (90-day cooldown) surfaces a "send anyway" override
 * rather than silently failing, because a human decided to send.
 */
export default function ReactivationClient() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  async function send(force: boolean) {
    const trimmed = phone.trim();
    if (!trimmed) {
      setNotice({ kind: 'error', text: 'Enter a customer phone number first.' });
      return;
    }

    setSending(true);
    setNotice(null);
    try {
      const res = await fetch('/api/customer/reactivation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerPhone: trimmed, force }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setNotice({
          kind: 'ok',
          text: data.campaign?.messageText
            ? `Sent: "${data.campaign.messageText}"`
            : 'Reactivation campaign sent.',
        });
        setPhone('');
        router.refresh();
      } else if (res.status === 409) {
        setNotice({
          kind: 'warn',
          text: data.error || 'Customer received a campaign in the last 90 days.',
        });
      } else {
        setNotice({ kind: 'error', text: data.error || 'Failed to send campaign.' });
      }
    } catch (err: any) {
      setNotice({ kind: 'error', text: err?.message || 'Network error — try again.' });
    } finally {
      setSending(false);
    }
  }

  const noticeClasses =
    notice?.kind === 'ok'
      ? 'border-emerald-900 bg-emerald-950/40 text-emerald-300'
      : notice?.kind === 'warn'
        ? 'border-amber-900 bg-amber-950/40 text-amber-300'
        : 'border-red-900 bg-red-950/40 text-red-300';

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(false);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Customer phone, e.g. 27821234567"
          className="w-full rounded-md border border-app-border-strong bg-app-surface-0 px-3 py-2 font-mono text-xs text-app-fg outline-none placeholder:text-app-faint focus:border-emerald-600"
        />
        <button
          type="submit"
          disabled={sending}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-emerald-800 bg-emerald-950/60 px-4 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {sending ? 'Sending…' : 'Send campaign'}
        </button>
      </form>

      {notice && (
        <div className={`flex flex-col gap-2 rounded-lg border px-3 py-2 text-xs ${noticeClasses}`}>
          <span>{notice.text}</span>
          {notice.kind === 'warn' && (
            <button
              type="button"
              onClick={() => send(true)}
              disabled={sending}
              className="w-fit rounded-md border border-amber-800 bg-amber-950/60 px-3 py-1.5 font-medium text-amber-300 hover:bg-amber-900/60 disabled:opacity-50"
            >
              Send anyway
            </button>
          )}
        </div>
      )}
    </div>
  );
}
