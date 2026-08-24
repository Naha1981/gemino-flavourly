'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';

/**
 * Manual reactivation send. POSTs /api/customer/reactivation for one
 * customer; the API enforces the same generator, POPIA opt-out rule and
 * 90-day cooldown as the cron, so this button cannot become a spam button.
 */
export default function SendCampaignForm() {
  const router = useRouter();
  const [customerPhone, setCustomerPhone] = useState('');
  const [segment, setSegment] = useState<'dormant' | 'at_risk'>('dormant');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/customer/reactivation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerPhone: customerPhone.trim(), segment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Send failed (${res.status})`);
      } else if (data.warning) {
        setSuccess(`Campaign created — ${data.warning}`);
      } else {
        setSuccess(`Reactivation message sent to ${customerPhone.trim()}`);
      }
      if (res.ok) {
        setCustomerPhone('');
        router.refresh();
      }
    } catch {
      setError('Network error — could not reach the reactivation API');
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-4"
    >
      <h2 className="mb-3 text-sm font-semibold text-zinc-100">Send a campaign manually</h2>
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <div className="flex-1">
          <label
            htmlFor="customer-phone"
            className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500"
          >
            Customer phone
          </label>
          <input
            id="customer-phone"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="e.g. 27821234567"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-600"
          />
        </div>
        <div>
          <label
            htmlFor="campaign-segment"
            className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500"
          >
            Segment
          </label>
          <select
            id="campaign-segment"
            value={segment}
            onChange={(e) => setSegment(e.target.value as 'dormant' | 'at_risk')}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-600"
          >
            <option value="dormant">Dormant (180+ days)</option>
            <option value="at_risk">At-risk (120–180 days)</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={sending || customerPhone.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-md border border-emerald-800/70 bg-emerald-950/60 px-4 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {sending ? 'Sending…' : 'Send campaign'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {success && <p className="mt-2 text-xs text-emerald-400">{success}</p>}
    </form>
  );
}
