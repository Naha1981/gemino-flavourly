'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { ArrowRight, CalendarCheck, Timer, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export default function LandingClient() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 antialiased">
      {/* ── Nav ─────────────────────────────────────────── */}
      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          {/* Double-click logo = Super Admin (hidden door) */}
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
            <SignedOut>
              <SignInButton forceRedirectUrl="/dashboard">
                <button className="rounded-md px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:text-white">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton forceRedirectUrl="/dashboard">
                <button className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white shadow-sm">
                  Get Started
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
            Your customers already message you on WhatsApp. Gemino replies in seconds —
            books the table, joins the waitlist, takes the deposit — while you run the
            floor. Because a missed message is a customer eating somewhere else.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <SignedOut>
              <SignUpButton forceRedirectUrl="/dashboard">
                <button className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-6 py-3.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 shadow-md">
                  Get Started — 5 Minute Setup <ArrowRight className="h-4 w-4" />
                </button>
              </SignUpButton>
              <SignInButton forceRedirectUrl="/dashboard">
                <button className="w-full sm:w-auto rounded-md border border-zinc-700 px-6 py-3.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-900">
                  Sign In
                </button>
              </SignInButton>
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
            No app for your customers. They just WhatsApp you, like always.
          </p>
        </section>

        {/* ── Outcomes, not features ────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="grid gap-6 md:grid-cols-3">
            <OutcomeCard
              icon={Timer}
              title="Replies in 3 seconds, 24/7"
              body="Your best host never sleeps. Every customer gets an instant, friendly reply — 2pm or 2am — so they never take their booking to a competitor."
            />
            <OutcomeCard
              icon={CalendarCheck}
              title="Tables book themselves"
              body="Bookings, waitlists, deposits and reminders all happen inside the WhatsApp chat. No-shows drop. Quiet nights fill up."
            />
            <OutcomeCard
              icon={TrendingUp}
              title="Guests keep coming back"
              body="Gemino remembers your regulars, rewards them automatically, and quietly wins back anyone who hasn't visited in a while."
            />
          </div>
        </section>

        {/* ── How it works ──────────────────────────────── */}
        <section className="border-t border-zinc-800/80 py-20 bg-zinc-950/50">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-2xl font-semibold text-zinc-100">Live in 5 minutes</h2>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <Step n="1" title="Create your account" body="One email and a password. That's it." />
              <Step n="2" title="Scan the QR code" body="Link your restaurant's WhatsApp exactly like WhatsApp Web." />
              <Step n="3" title="Watch it work" body="Send a test message, get an instant AI reply, see it all in your dashboard." />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-800/80 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 text-sm text-zinc-500">
          <span>© {new Date().getFullYear()} Gemino AI. Your restaurant, always on.</span>
          <Link href="/dashboard" className="transition-colors hover:text-zinc-300 text-xs">
            Tenant Portal
          </Link>
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

