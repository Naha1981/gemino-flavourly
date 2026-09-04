'use client';

import { useState } from 'react';
import { Check, Pencil, RefreshCw, Send } from 'lucide-react';

/**
 * Gate #12 — editable response draft per review. The AI's draft arrives as
 * a prop; the owner can edit it, regenerate it, or mark it sent (posting to
 * Google happens in the Business Profile — this records the approval).
 * Nothing here sends anything to the reviewer: the buttons only mutate the
 * tenant's own draft/state via the reviews API.
 */
export function ReviewCard({
  reviewId,
  initialDraft,
  sentAt,
}: {
  reviewId: string;
  initialDraft: string;
  sentAt: string | null;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [busy, setBusy] = useState<'save' | 'send' | 'regen' | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(sentAt);

  async function call(
    kind: 'save' | 'send' | 'regen',
    url: string,
    init: RequestInit,
    onOk: (data: { response_text?: string; response_sent_at?: string | null }) => void
  ) {
    setBusy(kind);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      onOk(data);
      if (kind !== 'send') {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(null);
    }
  }

  const isSent = sent !== null;

  return (
    <div className="mt-3 rounded-md border border-app-border bg-app-bg/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-app-faint">
        <Pencil className="h-3 w-3 text-emerald-400" />
        Response draft {isSent && <span className="text-app-faint">(already sent — editing disabled)</span>}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={isSent || busy !== null}
        rows={3}
        maxLength={2000}
        placeholder="No draft yet — press Regenerate to create one."
        className="w-full rounded-md border border-app-border bg-app-surface-0 p-2 text-sm text-app-fg outline-none focus:border-emerald-600 disabled:opacity-60"
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {saved && <p className="mt-1 text-xs text-emerald-400">Saved ✓</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {!isSent && (
          <>
            <button
              type="button"
              disabled={busy !== null || draft.trim().length === 0}
              onClick={() =>
                call('save', `/api/reputation/reviews/${encodeURIComponent(reviewId)}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ response_text: draft }),
                }, () => undefined)
              }
              className="flex items-center gap-1.5 rounded-md border border-app-border-strong bg-app-surface-0 px-3 py-1.5 text-xs text-app-fg hover:bg-app-surface-1 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                call('regen', `/api/reputation/reviews/${encodeURIComponent(reviewId)}/regenerate`, {
                  method: 'POST',
                }, (data) => {
                  if (typeof data.response_text === 'string') setDraft(data.response_text);
                })
              }
              className="flex items-center gap-1.5 rounded-md border border-app-border-strong bg-app-surface-0 px-3 py-1.5 text-xs text-app-fg hover:bg-app-surface-1 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy === 'regen' ? 'animate-spin' : ''}`} />{' '}
              {busy === 'regen' ? 'Regenerating…' : 'Regenerate'}
            </button>
            <button
              type="button"
              disabled={busy !== null || draft.trim().length === 0}
              onClick={() =>
                call('send', `/api/reputation/reviews/${encodeURIComponent(reviewId)}/send`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ response_text: draft }),
                }, (data) => setSent(data.response_sent_at ?? new Date().toISOString()))
              }
              className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> {busy === 'send' ? 'Marking…' : 'Send response'}
            </button>
          </>
        )}
        {isSent && (
          <span className="text-xs text-app-faint">
            Response marked sent on {new Date(sent).toISOString().slice(0, 10)}
          </span>
        )}
      </div>
    </div>
  );
}
