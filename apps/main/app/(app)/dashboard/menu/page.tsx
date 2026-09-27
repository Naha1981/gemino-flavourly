'use client';

import { useEffect, useState } from 'react';
import { Plus, ToggleLeft, ToggleRight, UtensilsCrossed } from 'lucide-react';

type Item = { id: string; name: string; category: string | null; description: string | null; priceCents: number | null; available: boolean; position: number };

export default function MenuManagerPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [role, setRole] = useState('none');
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', price: '', category: '' });

  async function load() {
    const r = await fetch('/api/menu-items', { cache: 'no-store' });
    const data = await r.json();
    setItems(data.items ?? []);
    setRole(data.role ?? 'none');
  }
  useEffect(() => { void load(); }, []);

  async function toggle(item: Item) {
    setBusy(item.id);
    await fetch(`/api/menu-items/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ available: !item.available }) });
    await load();
    setBusy(null);
  }

  async function add() {
    if (!draft.name.trim()) return;
    setBusy('new');
    await fetch('/api/menu-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: draft.name, category: draft.category, priceCents: draft.price ? Math.round(Number(draft.price) * 100) : null }),
    });
    setDraft({ name: '', price: '', category: '' });
    await load();
    setBusy(null);
  }

  const editable = role === 'owner' || role === 'manager';
  return <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div><h1 className="headline-md flex items-center gap-2 text-app-fg dark:text-zinc-50"><UtensilsCrossed className="h-5 w-5 text-app-secondary" /> Menu Manager</h1><p className="label-sm mt-1 text-app-muted">Switch dishes on/off instantly so customer recommendations never point at unavailable items.</p></div>
      <span className="rounded-full border border-app-border px-3 py-1 text-xs">{items.length} items</span>
    </div>
    {editable && <div className="glass-card p-5"><div className="grid gap-3 md:grid-cols-4"><input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="Dish name" className="rounded-lg border p-2 text-sm bg-app-surface-0"/><input value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})} placeholder="Category" className="rounded-lg border p-2 text-sm bg-app-surface-0"/><input value={draft.price} onChange={e=>setDraft({...draft,price:e.target.value})} placeholder="Price (R)" inputMode="decimal" className="rounded-lg border p-2 text-sm bg-app-surface-0"/><button disabled={busy==='new'} onClick={add} className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-emerald-600"><Plus className="mr-1 inline h-4 w-4"/>Add item</button></div></div>}
    <div className="overflow-hidden rounded-2xl border border-app-border">
      <table className="w-full text-left text-sm"><thead className="bg-app-surface-1 text-xs uppercase text-app-muted"><tr><th className="px-4 py-3">Dish</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Price</th><th className="px-4 py-3">Availability</th></tr></thead>
      <tbody className="divide-y divide-app-border">{items.map(item=><tr key={item.id}><td className="px-4 py-3 font-medium">{item.name}</td><td className="px-4 py-3 text-app-muted">{item.category||'—'}</td><td className="px-4 py-3">{item.priceCents==null?'—':`R${(item.priceCents/100).toFixed(0)}`}</td><td className="px-4 py-3">{editable?<button onClick={()=>toggle(item)} disabled={busy===item.id} className="inline-flex items-center gap-2">{item.available?<ToggleRight className="h-6 w-6 text-emerald-600"/>:<ToggleLeft className="h-6 w-6 text-zinc-400" />}<span>{item.available?'Available':'Unavailable'}</span></button>:<span>{item.available?'Available':'Unavailable'}</span>}</td></tr>)}</tbody></table>
      {items.length===0 && <div className="p-8 text-center text-sm text-app-muted">No menu items are on record yet. Add your menu items here.</div>}
    </div>
  </div>;
}
