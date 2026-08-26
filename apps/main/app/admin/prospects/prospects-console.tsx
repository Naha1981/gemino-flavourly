'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Link2,
  ExternalLink,
  AlertTriangle,
  Upload,
} from 'lucide-react';
import type { ProspectStatus } from '@/lib/brand-intelligence/prospects';

interface ProspectView {
  id: string;
  name: string;
  website: string;
  ownerEmail: string | null;
  ownerPhone: string | null;
  city: string | null;
  status: ProspectStatus;
  error: string | null;
  retries: number;
  tenantId: string | null;
  claimToken: string | null;
  createdAt: string;
}

const STATUS_BADGES: Record<ProspectStatus, string> = {
  queued: 'bg-zinc-800 text-zinc-300',
  enriching: 'bg-blue-950 text-blue-300',
  ready: 'bg-emerald-950 text-emerald-300',
  failed: 'bg-red-950 text-red-300',
  claimed: 'bg-amber-950 text-amber-300',
};

export function ProspectsConsole({
  initialProspects,
  counts,
}: {
  initialProspects: ProspectView[];
  counts: Partial<Record<ProspectStatus, number>>;
}) {
  const router = useRouter();
  const [prospects, setProspects] = useState(initialProspects);
  const [statusCounts, setStatusCounts] = useState(counts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [form, setForm] = useState({ name: '', website: '', ownerEmail: '', ownerPhone: '', city: '' });
  const [csvFile, setCsvFile] = useState<File | null>(null);

  const sorted = useMemo(
    () => [...prospects].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [prospects]
  );

  async function api<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any).error || 'Request failed');
    return data as T;
  }

  async function refresh() {
    const data = await api<{ prospects: ProspectView[]; counts: Partial<Record<ProspectStatus, number>> }>('/api/prospects', { cache: 'no-store' });
    setProspects(data.prospects);
    setStatusCounts(data.counts || {});
    router.refresh();
  }

  function notify(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  async function addProspect() {
    if (!form.name.trim() || !form.website.trim()) {
      notify('Name and website are required.');
      return;
    }
    setBusyId('add');
    try {
      await api('/api/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setForm({ name: '', website: '', ownerEmail: '', ownerPhone: '', city: '' });
      notify('Prospect added.');
      await refresh();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function uploadCsv() {
    if (!csvFile) {
      notify('Choose a CSV file first.');
      return;
    }
    setBusyId('csv');
    try {
      const fd = new FormData();
      fd.append('file', csvFile);
      const data = await api<{ imported: number; failed: number }>('/api/prospects/import', { method: 'POST', body: fd });
      notify(`Imported ${data.imported} prospects${data.failed ? ` (${data.failed} failed)` : ''}.`);
      setCsvFile(null);
      await refresh();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function build(id: string) {
    setBusyId(id);
    try {
      await api(`/api/prospects/${id}/build`, { method: 'POST' });
      notify('Demo tenant built & magic link generated.');
      await refresh();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function generateLink(id: string) {
    setBusyId(id);
    try {
      const data = await api<{ claimLink: string }>(`/api/prospects/${id}/magic-link`, { method: 'POST' });
      await copy(data.claimLink);
      notify('Magic link generated & copied.');
      await refresh();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function retry(id: string) {
    setBusyId(id);
    try {
      await api(`/api/prospects/${id}/retry`, { method: 'POST' });
      notify('Prospect re-queued.');
      await refresh();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be unavailable in preview iframes; fall back to a prompt.
      window.prompt('Copy this magic link:', text);
    }
  }

  function claimHref(token: string): string | null {
    return token ? `/claim/${token}` : null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">Prospects</h1>
          <p className="text-xs text-zinc-400">
            Build pre-configured demo tenants for sales pitches, then hand out a magic link for the owner to claim.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          {Object.entries(statusCounts).map(([status, n]) => (
            <span key={status} className={`inline-flex items-center rounded-full px-2.5 py-0.5 ${STATUS_BADGES[status as ProspectStatus] ?? 'bg-zinc-800 text-zinc-300'}`}>
              {status}: {n ?? 0}
            </span>
          ))}
        </div>
      </div>

      {toast && (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-200">
          {toast}
        </div>
      )}

      {/* Add prospect */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Add Prospect</h2>
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Restaurant name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Marble Johannesburg" />
          <Field label="Website" value={form.website} onChange={(v) => setForm({ ...form, website: v })} placeholder="https://marble.restaurant" />
          <Field label="Owner email" value={form.ownerEmail} onChange={(v) => setForm({ ...form, ownerEmail: v })} placeholder="chef@marble.co.za" />
          <Field label="Owner phone" value={form.ownerPhone} onChange={(v) => setForm({ ...form, ownerPhone: v })} placeholder="+27 11 555 1111" />
          <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} placeholder="Rosebank" />
        </div>
        <button
          onClick={addProspect}
          disabled={busyId === 'add' || busyId === 'csv'}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {busyId === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add Prospect
        </button>
      </section>

      {/* CSV import */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Bulk Import (CSV)</h2>
        <p className="mb-3 text-xs text-zinc-400">Columns: name, website, owner email, owner phone, city</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
            <Upload className="h-4 w-4" />
            {csvFile ? csvFile.name : 'Choose CSV'}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            onClick={uploadCsv}
            disabled={busyId === 'csv' || busyId === 'add'}
            className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
          >
            {busyId === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import CSV
          </button>
        </div>
      </section>

      {/* Table */}
      <section className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/50">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-zinc-800 text-zinc-500">
            <tr>
              <th className="px-4 py-2">Restaurant</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Retries</th>
              <th className="px-4 py-2">City</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-zinc-500">
                  No prospects yet. Add one or import a CSV to get started.
                </td>
              </tr>
            )}
            {sorted.map((p) => (
              <tr key={p.id} className="border-b border-zinc-800/60 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-100">{p.name}</div>
                  <div className="text-zinc-500">{p.website}</div>
                  {p.ownerEmail && <div className="text-zinc-600">{p.ownerEmail}</div>}
                  {p.error && <div className="mt-1 flex items-center gap-1 text-red-400"><AlertTriangle className="h-3 w-3" />{p.error}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 ${STATUS_BADGES[p.status]}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-400">{p.retries}</td>
                <td className="px-4 py-3 text-zinc-400">{p.city ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {p.status !== 'claimed' && (
                      <ActionButton
                        onClick={() => build(p.id)}
                        disabled={busyId === p.id}
                        loading={busyId === p.id && !p.claimToken}
                        title={p.claimToken ? 'Rebuild demo tenant' : 'Build demo tenant'}
                      >
                        <Sparkles className="h-3.5 w-3.5" /> Build
                      </ActionButton>
                    )}
                    {p.tenantId && p.status !== 'claimed' && (
                      <ActionButton
                        onClick={() => generateLink(p.id)}
                        disabled={busyId === p.id}
                        loading={busyId === p.id && !!p.claimToken}
                        title="Generate magic link"
                      >
                        <Link2 className="h-3.5 w-3.5" /> Link
                      </ActionButton>
                    )}
                    {p.claimToken && claimHref(p.claimToken) && (
                      <a
                        href={claimHref(p.claimToken)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2.5 py-1.5 font-medium text-zinc-900 hover:bg-white"
                        title="Open /claim in a new tab"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> View Demo
                      </a>
                    )}
                    {p.status === 'failed' && (
                      <ActionButton onClick={() => retry(p.id)} disabled={busyId === p.id} loading={false} title="Retry (if attempts remain)">
                        <RefreshCw className="h-3.5 w-3.5" /> Retry
                      </ActionButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
      />
    </label>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  loading,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
    </button>
  );
}
