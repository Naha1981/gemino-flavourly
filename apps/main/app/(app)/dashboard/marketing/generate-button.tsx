'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

export function GenerateBriefButton() {
  const [pending, setPending] = useState(false);
  async function generate() {
    setPending(true);
    try {
      await fetch('/api/marketing/briefs', { method: 'POST' });
      window.location.reload();
    } finally {
      setPending(false);
    }
  }
  return <button type="button" onClick={generate} disabled={pending} className="inline-flex items-center gap-2 rounded-md border border-emerald-800 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-950 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />{pending ? 'Generating...' : 'Generate'}</button>;
}