'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { Check, X, Loader2 } from 'lucide-react';

/**
 * Approve / reject actions for a pending approval request.
 *
 * Approving now actually dispatches the held message to the outbox (the
 * approval workflow is enforced by the webhook, which holds YELLOW/RED AI
 * replies and creates these requests). The server route relays the user's
 * Clerk id as the approver.
 */
export function ApprovalActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const { user } = useUser();
  const approver = user?.id || 'staff';
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(status: 'approved' | 'rejected') {
    setBusy(status);
    setError(null);
    try {
      const res = await fetch(`/api/operations/approval-requests/${requestId}?id=${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, approved_by: approver }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Action failed');
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        onClick={() => act('approved')}
        disabled={busy !== null}
        className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {busy === 'approved' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        Approve &amp; send
      </button>
      <button
        onClick={() => act('rejected')}
        disabled={busy !== null}
        className="inline-flex items-center gap-1 rounded-md border border-red-900 bg-zinc-950 px-3 py-1.5 text-xs text-red-300 hover:bg-zinc-800 disabled:opacity-50"
      >
        {busy === 'rejected' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        Reject
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
