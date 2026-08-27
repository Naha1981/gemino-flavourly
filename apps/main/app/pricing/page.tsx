import Link from 'next/link';
import { Check } from 'lucide-react';
// Degradation-aware wrapper: /pricing is prerendered at build time and is
// public, so a missing Clerk key must not fail the build or 500 the page.
import { SignUpButton } from '@/components/clerk-shell';

interface Tier {
  id: string;
  name: string;
  monthly: number;
  setup: number;
  blurb: string;
  engines: string[];
  featured?: boolean;
}

const TIERS: Tier[] = [
  {
    id: 'starter',
    name: 'Starter',
    monthly: 499,
    setup: 2500,
    blurb: 'Kota / takeaway',
    engines: ['Instant replies', 'Bookings & waitlist', 'WhatsApp connect'],
  },
  {
    id: 'casual',
    name: 'Casual',
    monthly: 1499,
    setup: 5000,
    blurb: 'Casual dining',
    engines: ['Everything in Starter', 'Loyalty & regulars', 'Reactivation campaigns'],
  },
  {
    id: 'premium',
    name: 'Premium',
    monthly: 3999,
    setup: 12500,
    blurb: 'Premium restaurant',
    engines: ['Everything in Casual', 'Review requests', 'Cancellation & no-show follow-up'],
    featured: true,
  },
  {
    id: 'signature',
    name: 'Signature',
    monthly: 7999,
    setup: 25000,
    blurb: 'Signature dining',
    engines: ['Everything in Premium', 'Market intelligence', 'Marketing campaigns'],
  },
  {
    id: 'group',
    name: 'Group',
    monthly: 19999,
    setup: 75000,
    blurb: 'Group + R2,500/location',
    engines: ['Everything in Signature', 'Multi-location', 'Dedicated support'],
  },
];

const ALL_ENGINES = [
  'Instant AI replies, 24/7',
  'Bookings, waitlist & deposits',
  'Loyalty & regular recognition',
  'Reactivation campaigns',
  'Review requests',
  'Cancellation & no-show follow-up',
  'Market intelligence',
  'Marketing campaigns',
  'POPIA-compliant opt-out',
  'Master kill-switch',
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 antialiased">
      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center">
            <img src="/logo.png" alt="Flavourly" className="h-9 w-auto" />
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/" className="text-sm text-zinc-300 hover:text-white">Home</Link>
            <Link href="/privacy" className="text-sm text-zinc-300 hover:text-white">Privacy</Link>
            <Link href="/terms" className="text-sm text-zinc-300 hover:text-white">Terms</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Simple, transparent pricing</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-400">
            Monthly billing in ZAR. Setup fee covers onboarding and WhatsApp configuration. <span className="text-emerald-400 font-medium">2 months free on annual</span> billing.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`relative flex flex-col rounded-xl border p-6 ${
                tier.featured ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/50'
              }`}
            >
              {tier.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-3 py-0.5 text-xs font-semibold text-zinc-950">
                  Popular
                </span>
              )}
              <h2 className="text-xl font-semibold">{tier.name}</h2>
              <p className="text-sm text-zinc-400">{tier.blurb}</p>
              <div className="mt-4">
                <span className="text-4xl font-bold">R{tier.monthly.toLocaleString()}</span>
                <span className="text-zinc-500">/mo</span>
              </div>
              <p className="mt-1 text-sm text-zinc-500">Setup: R{tier.setup.toLocaleString()}</p>

              <ul className="mt-6 flex-1 space-y-2">
                {tier.engines.map((e) => (
                  <li key={e} className="flex items-start gap-2 text-sm text-zinc-300">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    {e}
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                <SignUpButton forceRedirectUrl="/dashboard">
                  <button
                    className={`w-full rounded-md px-4 py-2.5 text-sm font-semibold transition-colors ${
                      tier.featured
                        ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                        : 'bg-zinc-100 text-zinc-900 hover:bg-white'
                    }`}
                  >
                    Start 14-day trial
                  </button>
                </SignUpButton>
              </div>
            </div>
          ))}
        </div>

        <section className="mt-20">
          <h2 className="text-center text-2xl font-semibold">All plans include</h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ALL_ENGINES.map((e) => (
              <div key={e} className="flex items-center gap-2 text-sm text-zinc-300">
                <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                {e}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16 rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-2xl font-semibold">Need a custom plan?</h2>
          <p className="mt-2 text-zinc-400">For large groups or franchise operations, talk to us.</p>
          <a
            href={`https://wa.me/${process.env.NEXT_PUBLIC_WHATSAPP_CONTACT || '27820000000'}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Contact us on WhatsApp
          </a>
        </section>
      </main>

      <footer className="border-t border-zinc-800/80 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-zinc-500">
          <span>&copy; {new Date().getFullYear()} Flavourly</span>
          <div className="flex gap-5">
            <Link href="/privacy" className="hover:text-zinc-300">Privacy</Link>
            <Link href="/terms" className="hover:text-zinc-300">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
