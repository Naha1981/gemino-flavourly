'use client';

import { useEffect, useState } from 'react';
import { CreditCard, AlertTriangle, CheckCircle2, Loader2, Crown, Sparkles, ShieldCheck } from 'lucide-react';

interface Tier {
  id: string;
  name: string;
  monthlyZAR: number;
  setupZAR: number;
  description: string;
}

interface BillingState {
  plan: string;
  planStatus: string;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  hasSubscription: boolean;
  readOnly: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
};

export default function BillingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [redirecting, setRedirecting] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/billing')
      .then((r) => (r.ok ? r.json() : Promise.resolve({ error: 'Failed to load billing' })))
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setBilling(data.billing);
          setTiers(data.tiers ?? []);
        }
      })
      .catch(() => setError('Failed to load billing'))
      .finally(() => setLoading(false));
  }, []);

  async function handleUpgrade(tierId: string) {
    setRedirecting(tierId);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: tierId }),
      });
      const data = await res.json();
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        setError(data.error || 'Checkout failed');
        setRedirecting(null);
      }
    } catch {
      setError('Checkout failed');
      setRedirecting(null);
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel your subscription? AI messaging will stop at the end of the current period.')) return;
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        window.location.reload();
      } else {
        setError(data.error || 'Cancel failed');
      }
    } catch {
      setError('Cancel failed');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-400">{error}</p>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing & Plan</h1>
        <p className="mt-1 text-sm text-app-muted">Manage your subscription and plan.</p>
      </div>

      {billing?.readOnly && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium text-amber-200">Renew to resume AI</p>
            <p className="mt-0.5 text-sm text-amber-300/80">
              Your AI messaging is paused. Renew your subscription to resume automated WhatsApp campaigns and AI responses.
            </p>
          </div>
        </div>
      )}

      {billing && (
        <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-emerald-400" />
                <h2 className="text-lg font-semibold capitalize">{billing.plan} plan</h2>
              </div>
              <p className="mt-1 text-sm text-app-muted">
                Status: <span className="capitalize">{STATUS_LABELS[billing.planStatus] ?? billing.planStatus}</span>
              </p>
            </div>
            <div className="text-right">
              {billing.planStatus === 'trialing' && billing.trialDaysLeft !== null ? (
                <div>
                  <p className="text-2xl font-bold">{billing.trialDaysLeft}</p>
                  <p className="text-xs text-app-faint">trial days left</p>
                </div>
              ) : billing.hasSubscription ? (
                <div className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm">Subscribed</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-4 text-lg font-semibold">Available plans</h2>
        <p className="mb-4 text-sm text-app-muted">2 months free on annual billing.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiers.map((tier) => {
            const current = billing?.plan === tier.id;
            return (
              <div
                key={tier.id}
                className={`flex flex-col rounded-lg border p-5 ${
                  current ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-app-border bg-app-surface-0/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                  <h3 className="font-semibold">{tier.name}</h3>
                </div>
                <p className="mt-1 text-xs text-app-faint">{tier.description}</p>
                <p className="mt-3 text-2xl font-bold">
                  R{tier.monthlyZAR.toLocaleString()}<span className="text-sm font-normal text-app-faint">/mo</span>
                </p>
                <p className="mt-0.5 text-xs text-app-faint">Setup: R{tier.setupZAR.toLocaleString()}</p>
                <div className="mt-auto pt-4">
                  {current ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-400">
                      <ShieldCheck className="h-4 w-4" /> Current plan
                    </span>
                  ) : (
                    <button
                      onClick={() => handleUpgrade(tier.id)}
                      disabled={redirecting !== null}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
                    >
                      {redirecting === tier.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CreditCard className="h-4 w-4" />
                      )}
                      Upgrade
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {billing?.hasSubscription && (
        <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-6">
          <h2 className="text-lg font-semibold">Manage subscription</h2>
          <p className="mt-1 text-sm text-app-muted">Cancel your recurring subscription. You will keep access until the current period ends.</p>
          <button
            onClick={handleCancel}
            className="mt-4 rounded-md border border-red-500/30 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10"
          >
            Cancel subscription
          </button>
        </div>
      )}
    </div>
  );
}
