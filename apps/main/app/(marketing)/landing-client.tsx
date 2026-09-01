'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
// Degradation-aware Clerk wrappers: when the publishable key is missing,
// or on a static marketing page with no ancestor ClerkProvider, the raw
// Clerk components would throw on the client and blank the landing page.
// See components/clerk-shell.
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@/components/clerk-shell';
import { AdminPortalGesture } from '@/components/brand/admin-portal-gesture';
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  ChevronDown,
  MapPin,
  MessageCircle,
  Pause,
  Phone,
  ShieldCheck,
} from 'lucide-react';

/**
 * GATE UI-5 / UI-5B — “The Closed Loop” landing rebuild.
 *
 * Design contract (owner-approved):
 * - Light linen theme (#FFFBF5 bg, charcoal text, forest green + champagne
 *   gold, display serif + Inter). No dark void, no purple/blue gradients,
 *   no glassmorphism, no icon-only cards.
 * - Every section anchored in warm restaurant photography (self-hosted in
 *   /public/images/landing, next/image with explicit sizes).
 * - Simple-English copy (UI-5B): pain → fix → money, Grade-7 reading level.
 * - Honesty rule: EVERY illustrative metric is badged “Example”. The old
 *   fabricated “platform overview” strip (invented numbers presented as
 *   live data) is gone by design.
 *
 * PERF-1 — signed-in redirect off `/`, moved from server to client (kept
 * verbatim; see app/(marketing)/page.tsx for why this page must stay static).
 */
function DashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);
  return null;
}

/** Small “Example” badge — the honesty rule made visible. */
function ExampleBadge({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
        dark ? 'bg-black/40 text-white/90' : 'bg-[#F3E9D7] text-[#8A6D35]'
      }`}
    >
      Example
    </span>
  );
}

export default function LandingClient() {
  return (
    <div className="min-h-screen bg-[#FFFBF5] text-[#4B463D] antialiased">
      <SignedIn>
        <DashboardRedirect />
      </SignedIn>

      {/* ── Nav ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-[#EADFCF] bg-[#FFFBF5]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          {/* QA-2 — same Super Admin affordance as the dashboard: double-click
              on desktop, press-and-hold 3s on mobile. /admin fails closed. */}
          <AdminPortalGesture className="text-left">
            <Image src="/logo.png" alt="Flavourly" width={144} height={89} className="h-9 w-auto" priority />
          </AdminPortalGesture>

          <nav className="flex items-center gap-3">
            <Link
              href="/pricing"
              className="hidden rounded-md px-3 py-2 text-sm font-medium text-[#5C554A] transition-colors hover:text-[#0E3B33] sm:inline"
            >
              Pricing
            </Link>
            <SignedOut>
              <SignInButton forceRedirectUrl="/dashboard">
                <button className="rounded-md px-4 py-2 text-sm font-medium text-[#5C554A] transition-colors hover:text-[#0E3B33]">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton forceRedirectUrl="/dashboard">
                <button className="rounded-full bg-[#0E3B33] px-5 py-2.5 text-sm font-semibold text-[#FFFBF5] shadow-sm transition-colors hover:bg-[#0A2E28]">
                  Start free trial
                </button>
              </SignUpButton>
            </SignedOut>
            <SignedIn>
              <Link
                href="/dashboard"
                className="rounded-full bg-[#0E3B33] px-5 py-2.5 text-sm font-semibold text-[#FFFBF5] shadow-sm transition-colors hover:bg-[#0A2E28]"
              >
                Open Dashboard
              </Link>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </nav>
        </div>
      </header>

      <main>
        {/* ── Hero — the loop promise over a dining room ── */}
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <Image
              src="/images/landing/hero-dining-room.jpg"
              alt="A warm, candlelit restaurant dining room set for service"
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0A1F1A]/90 via-[#0A1F1A]/60 to-[#0A1F1A]/25" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0A1F1A]/75 via-transparent to-[#0A1F1A]/30" />
          </div>

          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
            {/* Text column */}
            <div>
              <p className="mb-5 inline-block rounded-full border border-[#D9B36A]/60 bg-[#0A1F1A]/50 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-[#D9B36A]">
                Made for South African restaurants
              </p>
              <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
                Full tables. Even on Tuesdays.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
                Flavourly answers your WhatsApp in 2–3 seconds. It sees customers near your restaurant and
                invites them in. It fills your slow hours. It checks your competitors every day. And it shows
                you the money it made you — <span className="font-semibold text-[#D9B36A]">in Rands.</span>
              </p>
              <p className="mt-5 text-lg font-semibold text-[#D9B36A]">
                No other tool does all this. And proves it.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <SignedOut>
                  <Link
                    href="/sign-up"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#C9A25A] px-6 py-3.5 text-sm font-semibold text-[#1F1A10] shadow-lg transition-colors hover:bg-[#D9B36A]"
                  >
                    See it on your restaurant — 2 minutes <ArrowRight className="h-4 w-4" />
                  </Link>
                  <SignUpButton forceRedirectUrl="/dashboard">
                    <button className="inline-flex items-center justify-center gap-2 rounded-full border border-white/50 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/20">
                      Start free for 14 days
                    </button>
                  </SignUpButton>
                </SignedOut>
                <SignedIn>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#C9A25A] px-6 py-3.5 text-sm font-semibold text-[#1F1A10] shadow-lg transition-colors hover:bg-[#D9B36A]"
                  >
                    Open Your Dashboard <ArrowRight className="h-4 w-4" />
                  </Link>
                </SignedIn>
              </div>

              {/* Trust chips */}
              <ul className="mt-8 flex flex-wrap gap-2.5 text-xs text-white/80">
                {[
                  [MessageCircle, 'No app needed'],
                  [ShieldCheck, 'POPIA safe'],
                  [Pause, 'Pause anytime'],
                  [Phone, 'Your number stays yours'],
                ].map(([Icon, label]: any) => (
                  <li
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur"
                  >
                    <Icon className="h-3.5 w-3.5 text-[#D9B36A]" />
                    {label}
                  </li>
                ))}
              </ul>
            </div>

            {/* Floating example fragments — in flow (never overflow) */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/15 bg-white/95 p-4 shadow-2xl backdrop-blur sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0E3B33]">
                      <MessageCircle className="h-4 w-4 text-[#D9F2CE]" />
                    </span>
                    <div className="leading-tight">
                      <p className="text-xs font-semibold text-[#1E2B26]">Your restaurant’s WhatsApp</p>
                      <p className="text-[10px] text-[#8A8175]">online · replies like a host</p>
                    </div>
                  </div>
                  <ExampleBadge />
                </div>

                <div className="space-y-2">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-[#F1EDE5] px-3.5 py-2.5 text-sm text-[#3B362E]">
                    Hi! Is the bobotie on tonight? Table for 4 at 7?
                    <span className="mt-1 block text-right text-[10px] text-[#A39A8B]">18:59</span>
                  </div>
                  <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#D9F2CE] px-3.5 py-2.5 text-sm text-[#274D2C]">
                    It is. Table for 4 at 19:00 is yours — reply BOOK to confirm.
                    <span className="mt-1 block text-right text-[10px] text-[#7EA97F]">19:02 · Flavourly</span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-[#EADFCF] pt-3 text-xs">
                  <span className="flex items-center gap-1.5 text-[#5C554A]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#0E3B33]" /> Replied in 2.8s
                  </span>
                  <span className="font-semibold text-[#8A6D35]">R550 captured</span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/15 bg-white/95 p-4 shadow-xl backdrop-blur">
                  <div className="mb-2 flex items-center justify-between">
                    <MapPin className="h-4 w-4 text-[#0E3B33]" />
                    <ExampleBadge />
                  </div>
                  <p className="text-sm font-semibold text-[#1E2B26]">Dessert unlocked</p>
                  <p className="text-xs text-[#8A8175]">120m from the pass — at the table</p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/95 p-4 shadow-xl backdrop-blur">
                  <div className="mb-2 flex items-center justify-between">
                    <BellRing className="h-4 w-4 text-[#0E3B33]" />
                    <ExampleBadge />
                  </div>
                  <p className="text-sm font-semibold text-[#1E2B26]">Friday no-shows: 0</p>
                  <p className="text-xs text-[#8A8175]">48h · 24h · 6h reminders</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Sound familiar? — six pains, six fixes ─────── */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[#A98842]">
            Pain → Fix
          </p>
          <h2 className="text-center font-display text-3xl font-semibold text-[#1E2B26] sm:text-4xl">
            Sound familiar?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-[#5C554A]">
            Six things every restaurant owner tells us. Flavourly fixes them all — and each fix ends in money
            or pain removed.
          </p>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['“I miss WhatsApps while I’m on the floor.”', 'Answers in 2–3 seconds. Day and night.'],
              ['“People book and don’t show.”', 'Reminds them 3 times. No-shows drop.'],
              ['“Tuesdays are empty.”', 'Sees the quiet hours. Pulls in nearby customers with a special.'],
              ['“Customers come once, never again.”', 'Brings them back — rewards unlock only at your table.'],
              ['“I don’t know what my competitors are doing.”', 'Checks their menus, prices and stars every morning.'],
              ['“I spend on ads and don’t know if it worked.”', 'Shows you the Rands it recovered. Proof, not promises.'],
            ].map(([pain, fix]) => (
              <div key={pain} className="rounded-2xl border border-[#EADFCF] bg-white p-6 shadow-sm">
                <p className="text-sm italic leading-relaxed text-[#8A8175]">{pain}</p>
                <div className="my-4 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F3E9D7]">
                    <ArrowRight className="h-3.5 w-3.5 text-[#A98842]" />
                  </span>
                  <span className="h-px flex-1 bg-[#EADFCF]" />
                </div>
                <p className="text-base font-semibold leading-snug text-[#0E3B33]">{fix}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── The nearby invite ──────────────────────────── */}
        <section className="border-y border-[#EADFCF] bg-[#F5EFE5]">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-2">
            <div className="relative">
              <div className="overflow-hidden rounded-3xl shadow-2xl">
                <Image
                  src="/images/landing/plated-dish.jpg"
                  alt="A plated dessert with berry coulis, candlelit on a restaurant table"
                  width={1024}
                  height={1024}
                  sizes="(min-width: 1024px) 42vw, 90vw"
                  className="h-auto w-full object-cover"
                />
              </div>
              <div className="mt-4 flex items-center justify-between rounded-2xl border border-[#EADFCF] bg-white p-4 shadow-lg">
                <div>
                  <p className="text-sm font-semibold text-[#1E2B26]">Special sent · 2 blocks away</p>
                  <p className="text-xs text-[#8A8175]">Guest seated 12 minutes later</p>
                </div>
                <ExampleBadge />
              </div>
            </div>

            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#A98842]">
                The nearby invite
              </p>
              <h2 className="font-display text-3xl font-semibold leading-tight text-[#1E2B26] sm:text-4xl">
                They walk past. You don’t lift a finger.
              </h2>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#4B463D]">
                A customer who loves you walks past your door. Flavourly sends them a special. They sit down.
                You didn’t lift a finger.
              </p>
              <p className="mt-4 text-sm italic text-[#8A8175]">
                Only guests who joined your list and said yes. POPIA safe.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-[#4B463D]">
                {[
                  'Rewards unlock only when they’re seated at your table',
                  'No app for your guests — it all happens on WhatsApp',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0E3B33]" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Test before you spend ──────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="order-2 lg:order-1">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#A98842]">
                Before you spend
              </p>
              <h2 className="font-display text-3xl font-semibold leading-tight text-[#1E2B26] sm:text-4xl">
                Test your special on paper first.
              </h2>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#4B463D]">
                Write your special. Flavourly tests it on your customer types before you spend a Rand. It
                tells you what to fix — before your customers see it.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-[#5C554A]">
                A bad blanket discount teaches customers to wait for discounts. A tested one fills the exact
                seats that were going empty.
              </p>
            </div>

            <div className="order-1 rounded-2xl border border-[#EADFCF] bg-white p-6 shadow-xl lg:order-2">
              <div className="mb-5 flex items-center justify-between">
                <p className="text-sm font-semibold text-[#1E2B26]">Campaign test — before you send</p>
                <ExampleBadge />
              </div>

              <div className="space-y-5">
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs text-[#5C554A]">
                    <span>Your draft</span>
                    <span className="font-semibold">6/10</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#F1EDE5]">
                    <div className="h-2 w-[60%] rounded-full bg-[#C9A25A]" />
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs text-[#5C554A]">
                    <span>Improved version</span>
                    <span className="font-semibold text-[#0E3B33]">9/10</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#F1EDE5]">
                    <div className="h-2 w-[90%] rounded-full bg-[#0E3B33]" />
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-xl bg-[#F5EFE5] p-4 text-sm text-[#4B463D]">
                <span className="font-semibold text-[#0E3B33]">Try:</span> add a time limit — “Thursday only,
                18:00–20:00”
              </div>
              <p className="mt-4 text-xs text-[#8A8175]">
                Forecast only. Real results are measured after launch.
              </p>
            </div>
          </div>
        </section>

        {/* ── See the money — the receipt ────────────────── */}
        <section className="border-y border-[#EADFCF] bg-[#F5EFE5]">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
            <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[#A98842]">
              The receipt
            </p>
            <h2 className="text-center font-display text-3xl font-semibold text-[#1E2B26] sm:text-4xl">
              See the money
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-[#5C554A]">
              Every feature shows up in Rands. Here’s a month of them, on one slip.
            </p>

            <div className="mx-auto mt-10 max-w-md -rotate-1 rounded-lg border border-[#EADFCF] bg-white p-6 font-mono text-sm text-[#3B362E] shadow-2xl sm:p-8">
              <div className="text-center">
                <p className="text-base font-bold tracking-[0.25em] text-[#1E2B26]">FLAVOURLY</p>
                <p className="mt-1 text-xs text-[#8A8175]">MONTH ONE · ONE RESTAURANT</p>
              </div>
              <div className="my-4 border-t border-dashed border-[#D8CDB9]" />
              <ul className="space-y-3">
                {[
                  ['Missed WhatsApps caught', 'R11 000'],
                  ['No-shows stopped', 'R19 800'],
                  ['Slow Tuesday filled', 'R3 750'],
                  ['Old customers brought back', 'R6 000'],
                ].map(([item, amount]) => (
                  <li key={item} className="flex items-baseline justify-between gap-2">
                    <span>{item}</span>
                    <span className="flex-1 -translate-y-1 text-[#D8CDB9]">····················</span>
                    <span className="font-semibold text-[#0E3B33]">{amount}</span>
                  </li>
                ))}
              </ul>
              <div className="my-4 border-t border-dashed border-[#D8CDB9]" />
              <div className="flex items-baseline justify-between gap-2 text-base">
                <span className="font-bold">TOTAL</span>
                <span className="font-bold text-[#8A6D35]">R40 550</span>
              </div>
              <div className="mt-6 flex items-end justify-center gap-[3px]" aria-hidden="true">
                {[2, 5, 2, 6, 2, 3, 6, 2, 5, 2, 6, 3, 2, 6, 2, 5, 3, 6, 2, 2, 5, 6, 2, 3].map((h, i) => (
                  <span key={i} className="w-[2px] bg-[#3B362E]" style={{ height: `${h * 5}px` }} />
                ))}
              </div>
              <p className="mt-3 text-center text-[10px] tracking-[0.3em] text-[#8A8175]">
                THANK YOU — SEE YOU TONIGHT
              </p>
            </div>

            <p className="mx-auto mt-6 flex max-w-xl items-center justify-center gap-2 text-center text-sm text-[#8A6D35]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#F3E9D7] text-[10px] font-bold">
                i
              </span>
              Example numbers — your dashboard shows your real Rands.
            </p>
          </div>
        </section>

        {/* ── How it works — photographed steps ──────────── */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[#A98842]">
            Live in 5 minutes
          </p>
          <h2 className="text-center font-display text-3xl font-semibold text-[#1E2B26] sm:text-4xl">
            How it works
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-[#5C554A]">
            From QR code to Rand-counting, in one evening.
          </p>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="overflow-hidden rounded-2xl border border-[#EADFCF] bg-white shadow-sm">
              <div className="relative h-44">
                <Image
                  src="/images/landing/qr-table-tent.jpg"
                  alt="A QR-code table tent standing beside a candle on a restaurant table"
                  fill
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="p-6">
                <StepNumber n="1" />
                <h3 className="mt-3 text-base font-semibold text-[#1E2B26]">Connect your WhatsApp</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5C554A]">
                  5 minutes. Scan a code, like WhatsApp Web. Your number stays yours.
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[#EADFCF] bg-white shadow-sm">
              <div className="relative h-44">
                <Image
                  src="/images/landing/kitchen-pass.jpg"
                  alt="A chef garnishing a plate at the kitchen pass"
                  fill
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="p-6">
                <StepNumber n="2" />
                <h3 className="mt-3 text-base font-semibold text-[#1E2B26]">
                  It answers, reminds, invites and fills
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5C554A]">
                  While you cook. Every guest gets the same fast, friendly reply — from your menu, by your
                  rules.
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[#EADFCF] bg-white shadow-sm">
              <div className="relative flex h-44 items-center justify-center bg-[#0E3B33] p-5">
                <div className="w-full rounded-xl border border-white/15 bg-[#0A2E28] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
                      Tonight · 08:00 brief
                    </p>
                    <ExampleBadge dark />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      ['38', 'covers'],
                      ['0', 'no-shows'],
                      ['4', 'VIPs in'],
                    ].map(([num, label]) => (
                      <div key={label} className="rounded-lg bg-white/5 p-2">
                        <p className="text-lg font-semibold text-[#D9B36A]">{num}</p>
                        <p className="text-[10px] text-white/60">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="p-6">
                <StepNumber n="3" />
                <h3 className="mt-3 text-base font-semibold text-[#1E2B26]">You watch the Rands</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5C554A]">
                  On your dashboard, every morning. Real numbers, from your own payment data.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl px-6 pb-20 sm:pb-24">
          <h2 className="text-center font-display text-3xl font-semibold text-[#1E2B26] sm:text-4xl">
            Questions, answered.
          </h2>
          <div className="mt-10 space-y-4">
            {[
              [
                'Do my customers need an app?',
                'No. They just WhatsApp you.',
              ],
              [
                'Will the AI say wrong things?',
                'No. It only uses your menu and your rules. You approve anything risky.',
              ],
              ['Can I stop it?', 'Yes. One tap. Any time.'],
              [
                'How do I know it works?',
                'Your dashboard shows every Rand it recovered — from your own payment data.',
              ],
            ].map(([q, a]) => (
              <details key={q} className="group rounded-2xl border border-[#EADFCF] bg-white p-5 shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-[#1E2B26] [&::-webkit-details-marker]:hidden">
                  {q}
                  <ChevronDown className="h-4 w-4 shrink-0 text-[#A98842] transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-[#5C554A]">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Final CTA — over a warm room ───────────────── */}
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <Image
              src="/images/landing/guests-toasting.jpg"
              alt="Friends toasting wine glasses in a warmly lit restaurant"
              fill
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-[#0A1F1A]/70" />
          </div>
          <div className="mx-auto max-w-3xl px-6 py-24 text-center sm:py-28">
            <h2 className="font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Set your table in 5 minutes.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-white/85">
              If Flavourly doesn’t pay for itself, the dashboard will tell you — that’s the deal.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <SignedOut>
                <SignUpButton forceRedirectUrl="/dashboard">
                  <button className="inline-flex items-center justify-center gap-2 rounded-full bg-[#C9A25A] px-6 py-3.5 text-sm font-semibold text-[#1F1A10] shadow-lg transition-colors hover:bg-[#D9B36A]">
                    Start free for 14 days <ArrowRight className="h-4 w-4" />
                  </button>
                </SignUpButton>
                <Link
                  href="/sign-up"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/50 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/20"
                >
                  See it on your restaurant — 2 minutes
                </Link>
              </SignedOut>
              <SignedIn>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#C9A25A] px-6 py-3.5 text-sm font-semibold text-[#1F1A10] shadow-lg transition-colors hover:bg-[#D9B36A]"
                >
                  Open Your Dashboard <ArrowRight className="h-4 w-4" />
                </Link>
              </SignedIn>
            </div>
            <p className="mt-5 text-xs text-white/60">No card. Your number stays yours. Pause anytime.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#EADFCF] bg-[#FFFBF5]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-[#8A8175]">
            <span>&copy; {new Date().getFullYear()} Flavourly. Full tables. Even on Tuesdays.</span>
            <div className="flex flex-wrap gap-5">
              <Link href="/pricing" className="transition-colors hover:text-[#0E3B33]">
                Pricing
              </Link>
              <Link href="/privacy" className="transition-colors hover:text-[#0E3B33]">
                Privacy
              </Link>
              <Link href="/terms" className="transition-colors hover:text-[#0E3B33]">
                Terms
              </Link>
              <Link href="/dashboard" className="transition-colors hover:text-[#0E3B33]">
                Tenant Portal
              </Link>
            </div>
          </div>
          <p className="text-xs text-[#A39A8B]">
            Every number on this page is an example. Your dashboard shows your real Rands.
          </p>
        </div>
      </footer>
    </div>
  );
}

function StepNumber({ n }: { n: string }) {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#0E3B33] text-xs font-semibold text-[#D9B36A]">
      {n}
    </span>
  );
}
