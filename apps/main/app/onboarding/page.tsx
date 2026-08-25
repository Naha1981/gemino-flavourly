'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, ArrowLeft, CheckCircle2, QrCode, MessageSquare, ShieldCheck, Loader2, Phone } from 'lucide-react';

interface Profile {
  name: string;
  description: string;
  openingHours: string;
  address: string;
  menuText: string;
}

const STEPS = ['Restaurant profile', 'WhatsApp connect', 'Test message', 'Safety & POPIA', 'Done'];

export default function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  const [profile, setProfile] = useState<Profile>({
    name: '',
    description: '',
    openingHours: 'Monday - Sunday: 11:30 AM - 10:00 PM',
    address: '',
    menuText: '',
  });
  const [testPhone, setTestPhone] = useState('');
  const [testSent, setTestSent] = useState(false);
  const [popiaAccepted, setPopiaAccepted] = useState(false);

  useEffect(() => {
    fetch('/api/onboarding')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load'))))
      .then((data) => {
        if (data.onboardingComplete) {
          setComplete(true);
        } else if (data.profile) {
          setProfile((p) => ({ ...p, ...data.profile }));
        }
      })
      .catch(() => setError('Failed to load onboarding'))
      .finally(() => setLoading(false));
  }, []);

  async function saveStep(final = false) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(final ? { ...profile, complete: true } : profile),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      if (final) {
        setComplete(true);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function next() {
    if (step === 0) {
      saveStep(false).then(() => setStep(1));
    } else {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function sendTest() {
    if (!testPhone) {
      setError('Enter your phone number to receive the test message');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // The test message is delivered by the operator via the tenant's linked
      // WhatsApp account. We trigger it through the existing send path.
      const res = await fetch('/api/onboarding/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testPhone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send test message');
      setTestSent(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    await saveStep(true);
    // Record POPIA consent at onboarding completion.
    try {
      await fetch('/api/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: '2026-08-v1' }) });
    } catch {
      /* consent recording must not block completion */
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (complete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <div className="w-full max-w-lg space-y-6 rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center shadow-xl">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
          <h1 className="text-2xl font-bold">You are all set!</h1>
          <p className="text-sm text-zinc-400">Your restaurant is connected and ready to go live.</p>
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Go to Dashboard <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-2xl space-y-6 rounded-lg border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        <div>
          <h1 className="text-2xl font-bold">Welcome to Flavourly</h1>
          <p className="mt-1 text-sm text-zinc-400">Let&apos;s get your restaurant set up in a few minutes.</p>
        </div>

        <div className="flex gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1">
              <div className={`h-1.5 rounded-full ${i <= step ? 'bg-emerald-500' : 'bg-zinc-800'}`} />
              <p className="mt-1 truncate text-xs text-zinc-500">{label}</p>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="min-h-[260px]">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Restaurant profile</h2>
              <Field label="Restaurant name" value={profile.name} onChange={(v) => setProfile({ ...profile, name: v })} placeholder="Flavourly Kitchen" />
              <Field label="Description" value={profile.description} onChange={(v) => setProfile({ ...profile, description: v })} placeholder="A vibrant local bistro serving..." />
              <Field label="Trading hours" value={profile.openingHours} onChange={(v) => setProfile({ ...profile, openingHours: v })} />
              <Field label="Address" value={profile.address} onChange={(v) => setProfile({ ...profile, address: v })} placeholder="123 Main Rd, Johannesburg" />
              <Field label="Menu (dishes & prices)" value={profile.menuText} onChange={(v) => setProfile({ ...profile, menuText: v })} placeholder="Burger R89&#10;Pizza R120" multiline />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Connect WhatsApp</h2>
              <p className="text-sm text-zinc-400">Scan the QR code with your restaurant&apos;s WhatsApp to link it.</p>
              <div className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 p-8">
                <QrCode className="h-32 w-32 text-zinc-500" />
              </div>
              <p className="text-center text-xs text-zinc-500">QR code is generated from the WhatsApp page after setup.</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Send a test message</h2>
              <p className="text-sm text-zinc-400">Enter your own number and we&apos;ll send a test WhatsApp message.</p>
              <div className="flex gap-2">
                <input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+27 82 123 4567"
                  className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
                <button
                  onClick={sendTest}
                  disabled={saving || testSent}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                  {testSent ? 'Sent!' : 'Send test'}
                </button>
              </div>
              {testSent && <p className="text-sm text-emerald-400">Test message sent. Check your WhatsApp.</p>}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Safety & POPIA</h2>
              <div className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <div className="text-sm text-zinc-300">
                  <p className="font-medium">Master kill-switch</p>
                  <p className="mt-1 text-zinc-400">
                    You can pause all AI messaging at any time from Settings. Customers can opt out by replying STOP, which is enforced immediately.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-4">
                <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <div className="text-sm text-zinc-300">
                  <p className="font-medium">POPIA compliance</p>
                  <p className="mt-1 text-zinc-400">
                    We collect customer phone numbers and message history solely to operate your AI assistant. Data is retained only as long as needed and you can request deletion at any time. Customers may opt out via STOP.
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input type="checkbox" checked={popiaAccepted} onChange={(e) => setPopiaAccepted(e.target.checked)} className="h-4 w-4 rounded border-zinc-700" />
                I understand and accept the data usage described above
              </label>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
              <h2 className="text-lg font-semibold">You&apos;re ready!</h2>
              <p className="text-sm text-zinc-400">Finish setup to go live with your AI assistant.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-4">
          <button
            onClick={back}
            disabled={step === 0}
            className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={next}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              Next <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={finish}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Finish setup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const cls = 'w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500';
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-zinc-300">{label}</span>
      {multiline ? (
        <textarea rows={4} className={cls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </label>
  );
}
