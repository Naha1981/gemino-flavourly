'use client';

import { useEffect, useState } from 'react';

type Reward = { id: string; name: string; pointsCost: number; isActive: boolean };

export function RewardCatalogManager() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [name, setName] = useState('');
  const [points, setPoints] = useState('100');
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch('/api/rewards', { cache: 'no-store' });
    const data = await response.json();
    setRewards(data.rewards ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function addReward() {
    const response = await fetch('/api/rewards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pointsCost: Number(points) }),
    });
    const data = await response.json();
    setMessage(response.ok ? 'Reward added.' : data.error ?? 'Could not add reward.');
    if (response.ok) {
      setName('');
      await load();
    }
  }

  async function toggleReward(reward: Reward) {
    await fetch('/api/rewards/' + reward.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !reward.isActive }),
    });
    await load();
  }

  return (
    <section className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-6 space-y-4">
      <div className="border-b border-zinc-800 pb-3">
        <h2 className="text-sm font-semibold text-zinc-100">Owner reward catalogue</h2>
        <p className="mt-1 text-xs text-zinc-400">These are the rewards guests can actually redeem through the GPS gate.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_140px_auto]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reward name" className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
        <input value={points} onChange={(e) => setPoints(e.target.value)} inputMode="numeric" placeholder="Points" className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
        <button onClick={addReward} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">Add reward</button>
      </div>
      {message && <p className="text-xs text-zinc-400">{message}</p>}
      <div className="divide-y divide-zinc-800/60">
        {rewards.map((reward) => (
          <div key={reward.id} className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-medium text-zinc-100">{reward.name}</p>
              <p className="text-xs text-zinc-500">{reward.pointsCost} points</p>
            </div>
            <button onClick={() => toggleReward(reward)} className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">
              {reward.isActive ? 'Active' : 'Inactive'}
            </button>
          </div>
        ))}
        {!rewards.length && <p className="py-5 text-xs text-zinc-500">No custom rewards yet. The default reward remains available.</p>}
      </div>
    </section>
  );
}
