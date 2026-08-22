'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarCheck, Timer, TrendingUp, MessageCircle, ShieldCheck, UtensilsCrossed } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export default function LandingClient({ demo }: { demo: boolean }) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-ink text-cream grain">
      <header className="border-b border-line/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <button
            type="button"
            onDoubleClick={() => router.push('/admin')}
            className="flex select-none items-center gap-3 text-left"
            title="Flavourly (double-click for Admin)"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-saffron font-display text-lg font-semibold text-ink">
              F
            </span>
            <span className="font-display text-xl tracking-tight">Flavourly</span>
          </button>

          <nav className="flex items-center gap-3">
            <Link href="/sign-in" className="rounded-md px-4 py-2 text-sm text-cream-dim hover:text-cream">
              Sign in
            </Link>
            <Link
              href={demo ? '/dashboard' : '/sign-up'}
              className="rounded-md bg-cream px-4 py-2 text-sm font-semibold text-ink hover:bg-white"
            >
              {demo ? 'Open the floor' : 'Get started'}
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-2 lg:pt-24">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-ink-2 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-saffron">
              Built for rooms that live on WhatsApp
            </p>
            <h1 className="font-display text-5xl leading-[1.05] tracking-tight text-cream sm:text-6xl">
              Every message answered.
              <span className="block text-saffron">Every table filled.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-cream-dim">
              Guests already WhatsApp you. Flavourly replies in seconds — books the table,
              runs the waitlist, remembers the regulars — while you run the floor.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                href={demo ? '/dashboard' : '/sign-up'}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-saffron px-6 py-3.5 text-sm font-semibold text-ink hover:brightness-110"
              >
                {demo ? 'Tour The Marula Room' : 'Go live in five minutes'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/m/the-marula-room"
                className="inline-flex items-center justify-center rounded-md border border-line px-6 py-3.5 text-sm text-cream hover:bg-ink-2"
              >
                See a public menu
              </Link>
            </div>
            <p className="mt-4 text-xs text-cream-dim/70">R49 / month per restaurant. No app for your guests. No per-message tax.</p>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-2xl border border-line shadow-2xl shadow-black/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/hero-dining.jpg"
                alt="Candlelit dining room"
                className="h-[420px] w-full object-cover"
              />
            </div>
            <div className="absolute -bottom-6 left-6 right-6 rounded-xl border border-line bg-ink-2/95 p-4 backdrop-blur">
              <p className="text-[11px] uppercase tracking-widest text-saffron">Just now · WhatsApp</p>
              <p className="mt-1 text-sm text-cream">“Book a table for 2 tomorrow 7pm”</p>
              <p className="mt-2 text-sm text-cream-dim">
                Reserved. Table for 2 at The Marula Room, tomorrow 19:00. We hold it 15 minutes.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-20 pt-10">
          <div className="grid gap-5 md:grid-cols-3">
            <Outcome icon={Timer} title="Replies in seconds, 24/7" body="Your best host never sleeps. 14:00 or 02:00 — the guest never walks to a competitor." />
            <Outcome icon={CalendarCheck} title="Tables book themselves" body="Bookings, waitlist, reminders. All inside the chat they already opened." />
            <Outcome icon={TrendingUp} title="Regulars come back" body="Points, names, last visit. Flavourly remembers so you don't have to." />
          </div>
        </section>

        <section className="border-y border-line bg-ink-2/50 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center font-display text-3xl text-cream">Live before the dinner rush</h2>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <Step n="1" title="Create the house" body="One email. A tenant and a WhatsApp account are provisioned." />
              <Step n="2" title="Scan the QR" body="Link the restaurant number exactly like WhatsApp Web. Once." />
              <Step n="3" title="Watch the floor" body="A guest texts. The concierge answers. You see it in the inbox." />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-6 md:grid-cols-3">
            <Pillar icon={MessageCircle} title="You own the socket" body="Direct Baileys operator. No Twilio. No Evolution. No per-message rent." />
            <Pillar icon={ShieldCheck} title="POPIA from the first text" body="STOP is exact. START restores. Blocklisted numbers get silence." />
            <Pillar icon={UtensilsCrossed} title="Built for service" body="Inbox takeover, waitlist notify, loyalty ledger, 7am brief." />
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 text-sm text-cream-dim">
          <span>© {new Date().getFullYear()} Flavourly · Gemino engine</span>
          <button type="button" onDoubleClick={() => router.push('/admin')} className="text-xs hover:text-cream">
            House accounts
          </button>
        </div>
      </footer>
    </div>
  );
}

function Outcome({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line bg-ink-2 p-6">
      <div className="mb-4 inline-flex rounded-lg bg-ink p-2.5 text-saffron">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="font-display text-xl text-cream">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-cream-dim">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-saffron/40 font-display text-saffron">
        {n}
      </div>
      <h3 className="font-display text-lg text-cream">{title}</h3>
      <p className="mx-auto mt-2 max-w-xs text-sm text-cream-dim">{body}</p>
    </div>
  );
}

function Pillar({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-6">
      <Icon className="mb-3 h-5 w-5 text-saffron" />
      <h3 className="font-medium text-cream">{title}</h3>
      <p className="mt-2 text-sm text-cream-dim">{body}</p>
    </div>
  );
}
