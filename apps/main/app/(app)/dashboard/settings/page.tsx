'use client';

import { useState, useEffect } from 'react';
import { Save, CheckCircle2, Bot, Sparkles, Clock, Building, Sliders, Shield, MapPin, KeyRound, Moon, Sun } from 'lucide-react';
import { useThemeMode } from '@/components/theme-mode';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    openingHours: '',
    // Gates #15/#18 — the market engine's two tenant inputs: where the venue
    // is (competitor discovery searches a 5km radius around it) and what it
    // serves (positioning and opportunity analysis compare it to competitors).
    address: '',
    menuText: '',
    aiPersonality: 'friendly and professional',
    systemPrompt: '',
    aiEnabled: true,
    manualMode: false,
  });

  // Gate #11 — Google Places configuration (review monitoring). The API key
  // is write-only from the UI's perspective: it is never echoed back, so the
  // field stays empty unless the owner is (re)setting it, and leaving it
  // empty on save keeps the stored key.
  const [googleConfig, setGoogleConfig] = useState({ placeId: '', apiKey: '', hasApiKey: false, lastFetchAt: '' });
  const [googleSaving, setGoogleSaving] = useState(false);
  const [googleSuccess, setGoogleSuccess] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          if (data.tenant) {
            setFormData({
              name: data.tenant.name || '',
              description: data.tenant.description || '',
              openingHours: data.tenant.openingHours || 'Monday - Sunday: 11:30 AM - 10:00 PM',
              address: data.tenant.address || '',
              menuText: data.tenant.menuText || '',
              aiPersonality: data.tenant.aiPersonality || 'warm, professional, and hospitable',
              systemPrompt: data.tenant.systemPrompt || '',
              aiEnabled: data.tenant.aiEnabled ?? true,
              manualMode: data.tenant.manualMode ?? false,
            });
          }
        }
      } catch (err) {
        console.error('Failed to load settings', err);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  useEffect(() => {
    async function fetchGoogleConfig() {
      try {
        const res = await fetch('/api/reputation/google-config');
        if (res.ok) {
          const data = await res.json();
          if (data.config) {
            setGoogleConfig((prev) => ({
              ...prev,
              placeId: data.config.place_id || '',
              hasApiKey: Boolean(data.config.has_api_key),
              lastFetchAt: data.config.last_fetch_at
                ? new Date(data.config.last_fetch_at).toISOString().slice(0, 16).replace('T', ' ')
                : '',
            }));
          }
        }
      } catch (err) {
        console.error('Failed to load Google Places config', err);
      }
    }
    fetchGoogleConfig();
  }, []);

  async function handleGoogleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGoogleSaving(true);
    setGoogleSuccess(false);
    setGoogleError(null);
    try {
      const res = await fetch('/api/reputation/google-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          place_id: googleConfig.placeId,
          // Omit the key entirely when blank — the API keeps the stored one.
          ...(googleConfig.apiKey.trim() ? { api_key: googleConfig.apiKey.trim() } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setGoogleConfig((prev) => ({
          ...prev,
          apiKey: '',
          hasApiKey: Boolean(data.config?.has_api_key) || prev.hasApiKey,
        }));
        setGoogleSuccess(true);
        setTimeout(() => setGoogleSuccess(false), 4000);
      } else {
        const errData = await res.json().catch(() => ({}));
        setGoogleError(errData.error || 'Failed to save Google Places configuration');
      }
    } catch (err: any) {
      setGoogleError(err.message || 'An error occurred');
    } finally {
      setGoogleSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 4000);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'Failed to save settings');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl space-y-4">
        <div className="h-8 w-48 bg-app-surface-0 rounded animate-pulse" />
        <div className="h-4 w-96 bg-app-surface-0 rounded animate-pulse" />
        <div className="h-96 bg-app-surface-0/50 border border-app-border rounded-lg animate-pulse mt-8" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-app-fg">AI & Restaurant Configuration</h1>
        <p className="mt-1 text-sm text-app-muted">
          Customize how your autonomous WhatsApp Concierge interacts with guests and represents your brand.
        </p>
      </div>

      {/* Appearance — Stitch: light is default, dark is opt-in and persisted. */}
      <div className="rounded-lg border border-app-border bg-app-surface-0 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="label-md text-app-fg dark:text-zinc-50">Appearance</h2>
            <p className="mt-1 text-sm text-app-muted dark:text-zinc-400">
              Light mode is the default. Dark mode is saved on this device and applied everywhere.
            </p>
          </div>
          <ThemeModeSwitch />
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-900 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300 shadow-sm animate-in fade-in duration-200">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          Settings successfully updated. Your WhatsApp AI will immediately adopt this configuration.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300 shadow-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Brand Info */}
        <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2.5 pb-3 border-b border-app-border">
            <Building className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-app-fg uppercase tracking-wider">Restaurant Details</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-app-muted">Restaurant / Brand Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Flavourly Bistro & Grill"
                className="w-full rounded-md border border-app-border bg-app-bg px-3.5 py-2 text-sm text-app-fg placeholder:text-app-faint focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-app-muted flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-app-muted" />
                Opening Hours
              </label>
              <input
                type="text"
                value={formData.openingHours}
                onChange={(e) => setFormData({ ...formData, openingHours: e.target.value })}
                placeholder="e.g. Mon-Sun: 11:30 AM - 10:00 PM"
                className="w-full rounded-md border border-app-border bg-app-bg px-3.5 py-2 text-sm text-app-fg placeholder:text-app-faint focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-app-muted flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-app-muted" />
              Street Address
              <span className="text-[11px] text-app-faint font-normal">used to find competitors within 5km</span>
            </label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="e.g. 12 Loop Street, Cape Town, 8001"
              className="w-full rounded-md border border-app-border bg-app-bg px-3.5 py-2 text-sm text-app-fg placeholder:text-app-faint focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-app-muted flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5 text-app-muted" />
              Menu
              <span className="text-[11px] text-app-faint font-normal">
                one dish per line with its price — used for positioning and market gaps
              </span>
            </label>
            <textarea
              rows={5}
              value={formData.menuText}
              onChange={(e) => setFormData({ ...formData, menuText: e.target.value })}
              placeholder={`Starters\nSoup of the day R65\nMains\nRibeye steak R280\nVeggie burger R120`}
              className="w-full rounded-md border border-app-border bg-app-bg px-3.5 py-2.5 text-xs font-mono leading-relaxed text-app-fg placeholder:text-app-faint focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-app-muted">Description & Specialties</label>
            <textarea
              rows={2}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="e.g. Premium wood-fired steaks, artisan cocktails, and intimate terrace seating in Johannesburg."
              className="w-full rounded-md border border-app-border bg-app-bg px-3.5 py-2 text-sm text-app-fg placeholder:text-app-faint focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Section 2: AI Personality & Instructions */}
        <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2.5 pb-3 border-b border-app-border">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-app-fg uppercase tracking-wider">AI Concierge Persona</h2>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-app-muted">Tone & Personality</label>
            <input
              type="text"
              value={formData.aiPersonality}
              onChange={(e) => setFormData({ ...formData, aiPersonality: e.target.value })}
              placeholder="e.g. Warm, witty, sophisticated hospitality host"
              className="w-full rounded-md border border-app-border bg-app-bg px-3.5 py-2 text-sm text-app-fg placeholder:text-app-faint focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-app-muted flex items-center justify-between">
              <span>Custom AI System Instructions</span>
              <span className="text-[11px] text-app-faint font-normal">Optional overrides</span>
            </label>
            <textarea
              rows={4}
              value={formData.systemPrompt}
              onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
              placeholder={`You are the luxury WhatsApp concierge for ${formData.name || 'our restaurant'}. 
- Keep responses concise (1-3 sentences) suited for mobile messaging.
- For table reservations, ask for party size, date, and preferred seating time.
- If asked about dietary restrictions, highlight our halal and vegetarian options.`}
              className="w-full rounded-md border border-app-border bg-app-bg px-3.5 py-2.5 text-xs font-mono leading-relaxed text-app-fg placeholder:text-app-faint focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Section 3: Google Places Configuration (Gate #11) */}
        <form onSubmit={handleGoogleSubmit} className="rounded-lg border border-app-border bg-app-surface-0/50 p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2.5 pb-3 border-b border-app-border">
            <MapPin className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-app-fg uppercase tracking-wider">Google Places Configuration</h2>
          </div>
          <p className="text-xs text-app-faint -mt-2">
            Link your Google Business Profile so the 6am daily pull can monitor your reviews. Find your Place ID at{' '}
            <a
              href="https://developers.google.com/maps/documentation/places/web-service/place-id"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 hover:text-emerald-300"
            >
              Google&apos;s Place ID finder
            </a>
            .
          </p>

          {googleSuccess && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Google Places configuration saved. Reviews will pull daily at 6am.
            </div>
          )}
          {googleError && (
            <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">{googleError}</div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-app-muted">Google Place ID</label>
              <input
                type="text"
                required
                value={googleConfig.placeId}
                onChange={(e) => setGoogleConfig({ ...googleConfig, placeId: e.target.value })}
                placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                className="w-full rounded-md border border-app-border bg-app-bg px-3.5 py-2 text-sm text-app-fg placeholder:text-app-faint focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-app-muted flex items-center gap-1.5">
                <KeyRound className="w-3 h-3 text-app-muted" />
                Google Places API Key
                <span className="ml-auto text-[11px] font-normal text-app-faint">
                  {googleConfig.hasApiKey ? 'stored — leave blank to keep' : 'not set'}
                </span>
              </label>
              <input
                type="password"
                value={googleConfig.apiKey}
                onChange={(e) => setGoogleConfig({ ...googleConfig, apiKey: e.target.value })}
                placeholder={googleConfig.hasApiKey ? '••••••••••••••••' : 'AIza…'}
                autoComplete="off"
                className="w-full rounded-md border border-app-border bg-app-bg px-3.5 py-2 text-sm text-app-fg placeholder:text-app-faint focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-app-faint">
              {googleConfig.lastFetchAt ? `Last review pull: ${googleConfig.lastFetchAt}` : 'No review pull yet.'}
            </p>
            <button
              type="submit"
              disabled={googleSaving}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-700 bg-emerald-950/40 px-5 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-900/40 transition-colors disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {googleSaving ? 'Saving…' : 'Save Google Config'}
            </button>
          </div>
        </form>

        {/* Section 4: Safety & Controls */}
        <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-app-surface-1 p-2 text-emerald-400">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-app-fg">POPIA & GDPR Opt-Out Compliance</p>
              <p className="text-xs text-app-faint">Keywords like STOP or UNSUBSCRIBE automatically opt out customers.</p>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 transition-colors disabled:opacity-60 shadow-sm"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving Changes…' : 'Save Configuration'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Stitch appearance switch — light default, dark opt-in, persisted locally. */
function ThemeModeSwitch() {
  const { theme, setTheme } = useThemeMode();
  const btn = (mode: 'light' | 'dark', label: string, Icon: typeof Sun) => (
    <button
      type="button"
      onClick={() => setTheme(mode)}
      aria-pressed={theme === mode}
      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
        theme === mode
          ? 'border-stitch-gold bg-stitch-gold/15 text-stitch-brass dark:border-stitch-gold dark:text-stitch-gold'
          : 'border-app-border text-app-muted hover:bg-app-surface-2 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="Theme">
      {btn('light', 'Light', Sun)}
      {btn('dark', 'Dark', Moon)}
    </div>
  );
}
