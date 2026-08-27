'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Building2, ChevronsUpDown, Loader2 } from 'lucide-react';

export interface SwitcherTenant {
  id: string;
  name: string;
}

/**
 * S4 — sidebar tenant switcher. Lists every tenant the signed-in user
 * manages (server-rendered list; the API re-checks grants on switch) and
 * pins the selection via POST /api/tenant/switch, which sets the
 * flavourly_active_tenant cookie and answers 403 for any tenant the user
 * does not manage.
 */
export function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: SwitcherTenant[];
  activeTenantId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (tenants.length <= 1) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-app-border bg-app-surface-0 px-3 py-2 text-sm text-app-fg dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        <Building2 className="h-4 w-4 text-emerald-400" />
        <span className="truncate">{tenants[0]?.name ?? 'Your restaurant'}</span>
      </div>
    );
  }

  async function switchTenant(tenantId: string) {
    if (tenantId === activeTenantId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || 'You do not have access to that tenant.');
        return;
      }
      router.replace(`/dashboard?tenant=${tenantId}`);
      router.refresh();
    } catch {
      setError('Switch failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="tenant-switcher" className="space-y-1">
      <div className="relative">
        <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400" />
        <select
          data-testid="tenant-switcher-select"
          aria-label="Switch tenant"
          value={activeTenantId}
          disabled={busy}
          onChange={(e) => switchTenant(e.target.value)}
          className="w-full appearance-none rounded-md border border-app-border bg-app-surface-0 py-2 pl-9 pr-8 text-sm text-app-fg focus:border-stitch-gold dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-emerald-500 focus:outline-none"
        >
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {busy ? (
          <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />
        ) : (
          <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        )}
      </div>
      {error && (
        <p data-testid="tenant-switcher-error" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
