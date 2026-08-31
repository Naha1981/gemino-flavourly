'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, RefreshCw } from 'lucide-react';

/**
 * Cron Fleet Manager (Super Admin, /admin).
 *
 * 100% UI-driven cron lifecycle: paste the cron-job.org API key once (saved
 * encrypted to the database — no Vercel env vars, no redeploy), then sync
 * the whole canonical fleet with one button. The status list shows every
 * canonical job green (enabled on cron-job.org) or red (missing/disabled).
 * The job count is passed in from the server (which reads the canonical
 * fleet) so the copy can never drift from cron-fleet.json again — it said
 * "20 jobs" after the fleet grew to 22.
 */

interface FleetJobRow {
  name: string;
  key: string;
  url: string;
  jobId: number | null;
  status: 'enabled' | 'missing';
  schedule: string;
  action: string;
  isWatchdog: boolean;
}

interface FleetResponse {
  success?: boolean;
  ok?: boolean;
  message?: string;
  error?: string;
  jobs?: FleetJobRow[];
  summary?: { active?: number; total?: number };
}

export function CronFleetManager({
  initialKeyConfigured,
  fleetSize,
}: {
  initialKeyConfigured: boolean;
  /** Canonical jobs (excluding the watchdog) — from scripts/cron-fleet.json. */
  fleetSize: number;
}) {
  const [apiKey, setApiKey] = useState('');
  const [keyConfigured, setKeyConfigured] = useState(initialKeyConfigured);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [jobs, setJobs] = useState<FleetJobRow[]>([]);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const notify = useCallback((kind: 'success' | 'error', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 6000);
  }, []);

  useEffect(() => {
    // Show the current remote state on load (read-only: the sync endpoint is
    // idempotent — it only reports 'unchanged' when everything already
    // matches the canonical fleet).
  }, []);

  async function saveKey() {
    if (!apiKey.trim()) {
      notify('error', 'Paste your cron-job.org API key first.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings/cron-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        notify('error', data.error || 'Failed to save the API key.');
        return;
      }
      setKeyConfigured(true);
      setApiKey('');
      notify('success', 'API key saved (encrypted) to the database.');
    } catch {
      notify('error', 'Failed to save the API key.');
    } finally {
      setSaving(false);
    }
  }

  async function syncFleet() {
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/sync-crons', { cache: 'no-store' });
      const data: FleetResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify('error', data.error || `Sync failed (HTTP ${res.status}).`);
        return;
      }
      setJobs(data.jobs ?? []);
      if (data.success || data.ok) {
        const active = data.summary?.active ?? data.jobs?.filter((j) => j.status === 'enabled').length ?? 0;
        notify('success', data.message || `Fleet Synced: ${active} jobs active`);
      } else {
        notify('error', data.message || 'Sync did not complete.');
      }
    } catch {
      notify('error', 'Sync failed — network error.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="rounded-xl border border-app-border bg-app-surface-0 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-app-secondary-container text-app-on-secondary-container dark:bg-zinc-800 dark:text-stitch-gold">
          <RefreshCw className="h-5 w-5" />
        </span>
        <div>
          <h2 className="headline-md text-app-fg dark:text-zinc-50">Cron Fleet Manager</h2>
          <p className="mt-1 text-sm text-app-muted dark:text-zinc-400">
            The canonical fleet: {fleetSize} jobs + hourly system watchdog. Sync creates, updates, enables
            and de-duplicates every job on cron-job.org — without leaving Flavourly.
          </p>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          data-testid="fleet-toast"
          className={`mt-4 rounded-lg border px-4 py-2.5 text-sm ${
            toast.kind === 'success'
              ? 'border-app-secondary-container bg-app-secondary-container/40 text-app-on-secondary-container dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-app-error-container bg-app-error-container/40 text-app-error dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* API key input */}
      <div className="mt-5">
        <label htmlFor="cron-api-key" className="label-md text-app-fg dark:text-zinc-200">
          cron-job.org API key{' '}
          {keyConfigured ? (
            <span className="label-sm ml-2 rounded-full bg-app-secondary-container px-2 py-0.5 text-app-on-secondary-container dark:bg-zinc-800 dark:text-emerald-300">
              configured
            </span>
          ) : (
            <span className="label-sm ml-2 rounded-full bg-app-error-container px-2 py-0.5 text-app-error dark:bg-red-950 dark:text-red-300">
              not configured
            </span>
          )}
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-app-faint dark:text-zinc-500" />
            <input
              id="cron-api-key"
              type="password"
              autoComplete="off"
              placeholder="Paste your cron-job.org API key…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full rounded-lg border border-app-border bg-app-surface-1 py-2.5 pl-9 pr-3 text-sm text-app-fg focus:border-stitch-gold focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-stitch-gold"
            />
          </div>
          <button
            type="button"
            onClick={saveKey}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-app-primary px-4 py-2.5 text-sm font-semibold text-app-on-primary hover:opacity-90 disabled:opacity-50 dark:bg-stitch-gold dark:text-zinc-950"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Save Key
          </button>
        </div>
        <p className="label-sm mt-2 text-app-faint dark:text-zinc-500">
          Stored encrypted (AES-256-GCM) in the database. Sync reads it from the database first,
          falling back to the CRONJOB_API_KEY environment variable.
        </p>
      </div>

      {/* Sync button */}
      <button
        type="button"
        onClick={syncFleet}
        disabled={syncing}
        data-testid="fleet-sync-button"
        className="mt-6 inline-flex w-full items-center justify-center gap-3 rounded-xl bg-app-secondary px-6 py-4 text-base font-semibold text-white shadow-md transition-transform hover:scale-[1.01] disabled:opacity-60 dark:bg-emerald-600"
      >
        {syncing ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
        {syncing ? 'Syncing fleet…' : `Sync All ${fleetSize} Cron Jobs Now`}
      </button>

      {/* Live status list */}
      {jobs.length > 0 && (
        <ul className="mt-6 divide-y divide-app-border rounded-lg border border-app-border dark:divide-zinc-800 dark:border-zinc-800" data-testid="fleet-status-list">
          {jobs.map((job) => (
            <li key={job.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="flex min-w-0 items-center gap-2.5">
                {job.status === 'enabled' ? (
                  <span aria-label="enabled" className="text-app-secondary dark:text-emerald-400">✔</span>
                ) : (
                  <span aria-label="missing" className="text-app-error dark:text-red-400">✘</span>
                )}
                <span className="truncate text-app-fg dark:text-zinc-100">
                  {job.name}
                  {job.isWatchdog && <span className="label-sm ml-2 text-stitch-brass dark:text-stitch-gold">watchdog</span>}
                </span>
              </div>
              <code className="label-sm shrink-0 rounded bg-app-surface-2 px-2 py-0.5 text-app-muted dark:bg-zinc-800 dark:text-zinc-400">
                {job.schedule}
              </code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
