'use client';

import { useState } from 'react';
import { Loader2, Rocket, Save, Wand2 } from 'lucide-react';
import { PulseMapPanel, type PulseMapSimulation } from './pulsemap-panel';

/**
 * GATE PM-1 — the Campaign Builder (Draft → Simulate → Improve → Launch).
 *
 * The owner drafts a WhatsApp campaign, simulates how their own segments
 * will likely react, accepts the improved copy or keeps their original,
 * then launches via the EXISTING launch route. Simulation never sends:
 * it only reads aggregates and writes simulation rows.
 */

export interface BuilderCampaign {
  id: string;
  name: string;
  type: string;
  offer: string | null;
  message: string;
  targetSegment: string | null;
  startDate: string | null;
  status: string;
}

const TYPES = ['promotion', 'event', 'seasonal', 'announcement', 'custom'];
const SEGMENTS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All customers' },
  { value: 'vip', label: 'VIPs' },
  { value: 'regular', label: 'Regulars' },
  { value: 'at_risk', label: 'At-risk guests' },
  { value: 'dormant', label: 'Dormant guests' },
  { value: 'new', label: 'New customers' },
];

export function CampaignBuilder({
  draftCampaigns,
  demoMode,
  tenantParam = null,
}: {
  draftCampaigns: BuilderCampaign[];
  demoMode: boolean;
  /** Super-admin ?tenant= deep-link — kept on simulate/apply/save calls. */
  tenantParam?: string | null;
}) {
  // NOTE: no router.refresh() in this component, deliberately. A refresh
  // re-renders the server tree and can remount this builder mid-flow,
  // silently wiping the owner's draft/simulation/apply state (observed as
  // flaky UI during the PM-1 evidence pass). The campaign list below
  // refreshes naturally on the next navigation.
  /** Append the super-admin tenant selection to tenant-scoped fetches. */
  const tq = (url: string): string =>
    tenantParam ? `${url}${url.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(tenantParam)}` : url;
  const [form, setForm] = useState({
    name: '',
    type: 'promotion',
    offer: '',
    message: '',
    targetSegment: '',
    sendDate: '',
  });
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'simulate' | 'apply' | 'launch' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<PulseMapSimulation | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [cachedNote, setCachedNote] = useState<string | null>(null);
  const [launchResult, setLaunchResult] = useState<{ enqueued: number } | null>(null);

  const draftCount = draftCampaigns.length;

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function loadDraft(id: string) {
    const campaign = draftCampaigns.find((c) => c.id === id);
    if (!campaign) return;
    setSavedId(campaign.id);
    setForm({
      name: campaign.name,
      type: campaign.type,
      offer: campaign.offer ?? '',
      message: campaign.message,
      targetSegment: campaign.targetSegment ?? '',
      sendDate: campaign.startDate ? campaign.startDate.slice(0, 10) : '',
    });
    setSimulation(null);
    setUnavailableReason(null);
    setApplied(false);
    setLaunchResult(null);
    setError(null);
  }

  async function saveDraft(): Promise<string | null> {
    setError(null);
    if (!form.name.trim() || !form.message.trim()) {
      setError('Give the campaign a name and a message before saving.');
      return null;
    }
    setBusy('save');
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        offer: form.offer.trim() || null,
        message: form.message.trim(),
        target_segment: form.targetSegment || null,
        ...(form.sendDate ? { start_date: new Date(`${form.sendDate}T18:00:00`).toISOString() } : {}),
      };
      const res = await fetch(
        savedId ? tq(`/api/marketing/campaigns/${savedId}`) : '/api/marketing/campaigns',
        {
          method: savedId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setSavedId(data.campaign.id);
      return data.campaign.id as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function simulate() {
    setError(null);
    setLaunchResult(null);
    const campaignId = savedId ?? (await saveDraft());
    if (!campaignId) return;
    setBusy('simulate');
    setSimulation(null);
    setUnavailableReason(null);
    setApplied(false);
    setCachedNote(null);
    try {
      const res = await fetch(tq('/api/marketing/pulsemap/simulate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Simulation failed');
      if (data.status === 'unavailable' || !data.simulation) {
        setUnavailableReason(data.reason ?? null);
        return;
      }
      setSimulation(data.simulation as PulseMapSimulation);
      if (data.cached) setCachedNote('Showing your latest simulation — the draft has not changed since it ran.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setBusy(null);
    }
  }

  async function applyImproved() {
    if (!simulation) return;
    setError(null);
    setBusy('apply');
    try {
      const res = await fetch(tq(`/api/marketing/pulsemap/${simulation.id}/apply`), { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not apply the improved copy');
      setForm((f) => ({ ...f, message: data.campaign.message }));
      setApplied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply the improved copy');
    } finally {
      setBusy(null);
    }
  }

  async function launch() {
    const campaignId = savedId ?? (await saveDraft());
    if (!campaignId) return;
    setError(null);
    setBusy('launch');
    try {
      const res = await fetch(`/api/marketing/campaigns/${campaignId}/launch`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Launch failed');
      setLaunchResult({ enqueued: data.enqueued ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Launch failed');
    } finally {
      setBusy(null);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none';

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 pb-4">
        <Wand2 className="h-5 w-5 text-emerald-400" />
        <div>
          <h2 className="text-sm font-semibold text-zinc-50">Campaign Builder</h2>
          <p className="text-xs text-zinc-400">
            Draft → Simulate customer reaction → Improve → Launch.{' '}
            {demoMode && (
              <span className="rounded-full bg-amber-950 px-2 py-0.5 text-[11px] text-amber-300">
                Demo Mode: forecasts run on sample data
              </span>
            )}
          </p>
        </div>
        <span className="ml-auto rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] text-zinc-400">
          PulseMap for Campaigns
        </span>
      </div>

      {/* Step 1 — the draft */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <label htmlFor="pm-name" className="mb-1 block text-xs font-medium text-zinc-400">
              Campaign name
            </label>
            <input
              id="pm-name"
              className={inputClass}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Thursday Date Night"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pm-type" className="mb-1 block text-xs font-medium text-zinc-400">
                Type
              </label>
              <select id="pm-type" className={inputClass} value={form.type} onChange={(e) => set('type', e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pm-segment" className="mb-1 block text-xs font-medium text-zinc-400">
                Target segment
              </label>
              <select
                id="pm-segment"
                className={inputClass}
                value={form.targetSegment}
                onChange={(e) => set('targetSegment', e.target.value)}
              >
                {SEGMENTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pm-offer" className="mb-1 block text-xs font-medium text-zinc-400">
                Offer
              </label>
              <input
                id="pm-offer"
                className={inputClass}
                value={form.offer}
                onChange={(e) => set('offer', e.target.value)}
                placeholder="R299 for two"
              />
            </div>
            <div>
              <label htmlFor="pm-date" className="mb-1 block text-xs font-medium text-zinc-400">
                Send / valid from
              </label>
              <input
                id="pm-date"
                type="date"
                className={inputClass}
                value={form.sendDate}
                onChange={(e) => set('sendDate', e.target.value)}
              />
            </div>
          </div>
        </div>
        <div>
          <label htmlFor="pm-message" className="mb-1 block text-xs font-medium text-zinc-400">
            WhatsApp message
          </label>
          <textarea
            id="pm-message"
            rows={7}
            className={inputClass}
            value={form.message}
            onChange={(e) => set('message', e.target.value)}
            placeholder="R299 date-night meal for two this Thursday — 3 courses, menu included. Reply BOOK and we'll sort your table."
          />
        </div>
      </div>

      {/* Existing drafts quick-load */}
      {draftCount > 0 && !savedId && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span>Load an existing draft:</span>
          {draftCampaigns.slice(0, 4).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => loadDraft(c.id)}
              className="rounded-full border border-zinc-800 px-2.5 py-0.5 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Draft actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={saveDraft}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {savedId ? 'Update draft' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={simulate}
          disabled={busy !== null || !form.message.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy === 'simulate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Simulate customer reaction
        </button>
        {savedId && launchResult === null && (
          <button
            type="button"
            onClick={launch}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-800 bg-emerald-950 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900 disabled:opacity-50"
          >
            {busy === 'launch' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            Launch campaign
          </button>
        )}
        {savedId && <span className="text-[11px] text-zinc-600">draft saved</span>}
      </div>

      {cachedNote && <p className="text-xs text-zinc-500">{cachedNote}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {launchResult && (
        <p className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
          Campaign launched — {launchResult.enqueued} WhatsApp message{launchResult.enqueued === 1 ? '' : 's'} queued
          for delivery.
        </p>
      )}

      {/* Step 2 — the PulseMap panel (always carries the disclaimer) */}
      {(simulation || unavailableReason || busy === 'simulate') && (
        <div className="pt-2">
          {busy === 'simulate' && !simulation && !unavailableReason ? (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 p-6 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
              Running simulation on your segments…
              <span className="ml-1 text-xs text-amber-300">Forecast only. Real results are measured after launch.</span>
            </div>
          ) : (
            <PulseMapPanel
              simulation={simulation}
              unavailableReason={unavailableReason}
              applied={applied}
              busy={busy === 'apply' ? 'apply' : null}
              onApply={applyImproved}
              onKeep={() => setApplied(true)}
            />
          )}
        </div>
      )}
    </div>
  );
}
