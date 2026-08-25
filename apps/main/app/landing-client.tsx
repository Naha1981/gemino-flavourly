'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { ArrowRight, CalendarCheck, Timer, TrendingUp, Star, Megaphone, Swords, BarChart3, QrCode, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const WHATSAPP_CONTACT = process.env.NEXT_PUBLIC_WHATSAPP_CONTACT || '27820000000';

export default function LandingClient() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 antialiased">
      {/* ── Nav ─────────────────────────────────────────── */}
      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <button
            type="button"
            onDoubleClick={() => router.push('/admin')}
            className="flex select-none items-center gap-3 transition-transform active:scale-95 text-left"
            title="Gemino AI (Double-click for Admin)"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-lg font-bold text-zinc-900 shadow-sm">
              G
            </span>
            <span className="text-lg font-semibold tracking-tight">Gemino AI</span>
          </button>

          <nav className="flex items-center gap-3">
            <Link href="/pricing" className="hidden sm:inline rounded-md px-3 py-2 text-sm font-medium text-zinc-300 hover:text-white">
              Pricing
            </Link>
            <SignedOut>
              <SignInButton forceRedirectUrl="/dashboard">
                <button className="rounded-md px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:text-white">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton forceRedirectUrl="/dashboard">
                <button className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white shadow-sm">
                  Start free trial
                </button>
              </SignUpButton>
            </SignedOut>
            <SignedIn>
              <Link
                href="/dashboard"
                className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white shadow-sm"
              >
                Open Dashboard
              </Link>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </nav>
        </div>
      </header>

      <main>
        {/* ── Hero ──────────────────────────────────────── */}
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-24 text-center">
          <p className="mb-6 inline-block rounded-full border border-zinc-700 bg-zinc-900/60 px-4 py-1.5 text-xs font-medium text-zinc-300 shadow-sm">
            Built for restaurants that live on WhatsApp
          </p>
          <h1 className="text-5xl font-bold leading-tight tracking-tight sm:text-6xl text-zinc-50">
            Every WhatsApp message answered. Every table filled.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-zinc-400">
            Your customers already message you on WhatsApp. Gemino replies in seconds &mdash;
            books the table, joins the waitlist, takes the deposit &mdash; while you run the
            floor. Because a missed message is a customer eating somewhere else.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <SignedOut>
              <SignUpButton forceRedirectUrl="/dashboard">
                <button className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-6 py-3.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 shadow-md">
                  Start 14-day trial <ArrowRight className="h-4 w-4" />
                </button>
              </SignUpButton>
              <a
                href={`https://wa.me/${WHATSAPP_CONTACT}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md border border-emerald-500/40 px-6 py-3.5 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/10"
              >
                Contact us on WhatsApp
              </a>
            </SignedOut>
            <SignedIn>
              <Link
                href="/dashboard"
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-6 py-3.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 shadow-md"
              >
                Open Your Dashboard <ArrowRight className="h-4 w-4" />
              </Link>
            </SignedIn>
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            No app for your customers. They just WhatsApp you, like always. No credit card required.
          </p>
        </section>

        {/* ── Six engines ───────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 pb-20">
          <h2 className="mb-10 text-center text-2xl font-semibold text-zinc-100">Six engines, one AI assistant</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <OutcomeCard
              icon={Timer}
              title="Instant replies, 24/7"
              body="Your best host never sleeps. Every customer gets an instant, friendly reply — 2pm or 2am — so they never take their booking to a competitor."
            />
            <OutcomeCard
              icon={CalendarCheck}
              title="Tables book themselves"
              body="Bookings, waitlists, deposits and reminders all happen inside the WhatsApp chat. No-shows drop. Quiet nights fill up."
            />
            <OutcomeCard
              icon={Star}
              title="Regulars who come back"
              body="Gemino remembers your regulars, rewards them automatically, and quietly wins back anyone who has not visited in a while."
            />
            <OutcomeCard
              icon={Megaphone}
              title="Campaigns that convert"
              body="Broadcast promotions, events and seasonal offers to your whole customer base — and watch who comes back."
            />
            <OutcomeCard
              icon={Swords}
              title="Market intelligence"
              body="See every competitor within 5km — their ratings, menus and promotions — and find the gaps they are leaving open."
            />
            <OutcomeCard
              icon={BarChart3}
              title="Revenue you can recover"
              body="Cancellations and no-shows trigger a rebooking offer automatically. The bottom line, recovered."
            />
          </div>
        </section>

        {/* ── How it works ──────────────────────────────── */}
        <section className="border-t border-zinc-800/80 py-20 bg-zinc-950/50">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-2xl font-semibold text-zinc-100">Live in 5 minutes</h2>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <Step n="1" title="Start your free trial" body="One email. No credit card. Your 14-day trial starts immediately." />
              <Step n="2" title="Scan the QR code" body="Link your restaurant's WhatsApp exactly like WhatsApp Web." />
              <Step n="3" title="Watch it work" body="Send a test message, get an instant AI reply, see it all in your dashboard." />
            </div>
          </div>
        </section>

        {/* ── Trust ─────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
              <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="font-semibold text-zinc-50">No new app for guests</p>
                <p className="mt-1 text-sm text-zinc-400">They message you on WhatsApp, exactly as they already do.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="font-semibold text-zinc-50">POPIA compliant</p>
                <p className="mt-1 text-sm text-zinc-400">One-tap STOP opt-out, encrypted data, clear retention. Built for South Africa.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
              <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="font-semibold text-zinc-50">Pause anytime</p>
                <p className="mt-1 text-sm text-zinc-400">A master kill-switch stops all AI messaging instantly. You stay in control.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-800/80 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-zinc-500">
          <span>&copy; {new Date().getFullYear()} Gemino AI. Your restaurant, always on.</span>
          <div className="flex gap-5">
            <Link href="/pricing" className="transition-colors hover:text-zinc-300">Pricing</Link>
            <Link href="/privacy" className="transition-colors hover:text-zinc-300">Privacy</Link>
            <Link href="/terms" className="transition-colors hover:text-zinc-300">Terms</Link>
            <Link href="/dashboard" className="transition-colors hover:text-zinc-300">Tenant Portal</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function OutcomeCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 hover:border-zinc-700 transition-colors">
      <div className="mb-4 inline-flex rounded-md bg-zinc-800 p-2.5">
        <Icon className="h-5 w-5 text-emerald-400" />
      </div>
      <h3 className="mb-2 font-semibold text-zinc-50">{title}</h3>
      <p className="text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="text-center space-y-2">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 text-sm font-semibold text-emerald-400 bg-zinc-900 shadow-inner">
        {n}
      </div>
      <h3 className="font-semibold text-zinc-50 text-base">{title}</h3>
      <p className="text-sm text-zinc-400 max-w-xs mx-auto leading-relaxed">{body}</p>
    </div>
  );
}

