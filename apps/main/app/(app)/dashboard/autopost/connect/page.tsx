'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const PROVIDERS = ['Instagram', 'Facebook', 'TikTok', 'YouTube', 'LinkedIn'];

export default function AutoPostConnectPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [accountIds, setAccountIds] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/autopost/connection', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (data.configured) {
          setWorkspaceId(data.workspaceId ?? '');
          setAccountIds((data.socialAccountIds ?? []).join(', '));
          setStatus('saved');
        } else {
          setStatus('ready');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Could not load the AutoPost connection status.');
      });
  }, []);

  async function save() {
    setStatus('saving');
    setMessage('');
    const socialAccountIds = accountIds.split(',').map((value) => value.trim()).filter(Boolean);

    try {
      const response = await fetch('/api/autopost/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, socialAccountIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not save AutoPost connection.');
      setStatus('saved');
      setMessage('Connected. Future campaigns will publish only to this restaurant workspace/accounts.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not save AutoPost connection.');
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/dashboard/autopost" className="text-sm text-zinc-400 hover:text-zinc-200">← Back to AutoPost</Link>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-50">Connect restaurant social accounts</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Each restaurant gets its own OpenPost workspace and destination account IDs. Flavourly never reuses another restaurant&apos;s publishing destination.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="font-semibold text-zinc-100">Supported destinations</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {PROVIDERS.map((provider) => <span key={provider} className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{provider}</span>)}
        </div>
        <p className="mt-3 text-xs text-zinc-500">The actual OAuth connection is completed inside OpenPost. These IDs link the restaurant to the accounts it owns there.</p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-zinc-200">OpenPost workspace ID</span>
        <input value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500" placeholder="workspace UUID" />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-200">Connected social account IDs</span>
        <input value={accountIds} onChange={(event) => setAccountIds(event.target.value)} className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500" placeholder="account-1, account-2, account-3" />
        <span className="mt-2 block text-xs text-zinc-500">Comma-separated IDs copied from the restaurant&apos;s OpenPost workspace.</span>
      </label>

      <button onClick={save} disabled={status === 'saving' || !workspaceId.trim() || !accountIds.trim()} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50">
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Update connection' : 'Save connection'}
      </button>

      {message && <div className={`rounded-lg border p-3 text-sm ${status === 'error' ? 'border-red-900 bg-red-950/30 text-red-300' : 'border-emerald-900 bg-emerald-950/20 text-emerald-300'}`}>{message}</div>}
    </div>
  );
}
