'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Instagram,
  MessageCircle,
  Play,
  Sparkles,
  Users,
  Utensils,
  Video,
  Zap,
} from 'lucide-react';
import {
  SignedIn,
  SignedOut,
  SignUpButton,
  UserButton,
} from '@/components/clerk-shell';
import { AdminPortalGesture } from '@/components/brand/admin-portal-gesture';

function DashboardRedirect() {
  const router = useRouter();
  useEffect(() => router.replace('/dashboard'), [router]);
  return null;
}

const channels = ['Instagram', 'Facebook', 'TikTok', 'YouTube', 'LinkedIn'];

function Logo() {
  return (
    <AdminPortalGesture className="text-left">
      <Image src="/logo.png" alt="Flavourly" width={144} height={80} className="h-9 w-auto" priority />
    </AdminPortalGesture>
  );
}

function MiniDashboard() {
  return (
    <div className="relative mx-auto w-full max-w-[520px] rounded-[30px] border border-black/[0.08] bg-[#f7f7f9] p-2 shadow-[0_30px_90px_rgba(0,0,0,0.18)] sm:p-3">
      <div className="overflow-hidden rounded-[24px] bg-white">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/35">Today</p>
            <p className="mt-0.5 text-base font-semibold tracking-tight text-[#101014]">Restaurant growth</p>
          </div>
          <span className="rounded-full bg-[#ecf7ee] px-3 py-1.5 text-[11px] font-semibold text-[#1d7a38]">On track</span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {[
            ['Bookings', '38', '+18%', CalendarDays],
            ['Revenue', 'R8.4k', '+24%', BarChart3],
            ['Replies', '2.8s', 'avg', MessageCircle],
          ].map(([label, value, delta, Icon]) => (
            <div key={label as string} className="rounded-2xl bg-[#f7f7f9] p-4">
              <Icon className="h-4 w-4 text-black/45" />
              <p className="mt-4 text-[11px] font-medium text-black/45">{label as string}</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-[#101014]">{value as string}</p>
              <p className="mt-1 text-[11px] font-semibold text-[#26753a]">{delta as string}</p>
            </div>
          ))}
        </div>
        <div className="mx-4 mb-4 rounded-2xl bg-[#111113] p-4 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Opportunity detected</p>
              <p className="mt-2 text-base font-semibold">Your Tuesday is under-filled.</p>
              <p className="mt-1 text-xs leading-relaxed text-white/60">Launch a midweek campaign to customers most likely to book.</p>
            </div>
            <span className="rounded-full bg-white/10 p-2"><Sparkles className="h-4 w-4" /></span>
          </div>
          <button className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-black">
            Create campaign <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UnifiedLanding() {
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#111114] antialiased selection:bg-black selection:text-white">
      <SignedIn><DashboardRedirect /></SignedIn>

      <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-[#f5f5f7]/85 backdrop-blur-2xl">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Logo />
          <nav className="hidden items-center gap-8 md:flex">
            <a href="#how" className="text-sm font-medium text-black/55 transition hover:text-black">How it works</a>
            <a href="#platform" className="text-sm font-medium text-black/55 transition hover:text-black">Platform</a>
            <a href="#results" className="text-sm font-medium text-black/55 transition hover:text-black">Results</a>
            <Link href="/pricing" className="text-sm font-medium text-black/55 transition hover:text-black">Pricing</Link>
          </nav>
          <div className="flex items-center gap-2">
            <SignedOut>
              <Link href="/sign-in" className="hidden rounded-full px-4 py-2 text-sm font-semibold text-black/60 hover:text-black sm:inline-flex">Sign in</Link>
              <Link href="/sign-up" className="rounded-full bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-black/85">Get started</Link>
            </SignedOut>
            <SignedIn><UserButton afterSignOutUrl="/" /></SignedIn>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#f5f5f7]">
          <div className="absolute -left-32 top-16 h-72 w-72 rounded-full bg-[#d9efe0] blur-3xl" />
          <div className="absolute -right-32 top-32 h-96 w-96 rounded-full bg-[#e8dfcf] blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20 lg:grid-cols-[1fr_0.9fr] lg:gap-20 lg:pt-24">
            <div className="max-w-2xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/75 px-3.5 py-2 text-xs font-semibold text-black/55 shadow-sm backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-[#28a745]" /> Built for restaurants
              </div>
              <h1 className="text-[clamp(3.2rem,8vw,6.4rem)] font-semibold leading-[0.94] tracking-[-0.065em] text-[#111114]">
                Turn empty tables into revenue.
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-8 tracking-[-0.01em] text-black/55 sm:text-xl">
                Flavourly finds your next revenue opportunity, talks to guests on WhatsApp, fills slow periods and turns one idea into content across your social channels.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <SignedOut>
                  <Link href="/sign-up" className="inline-flex items-center justify-center gap-2 rounded-full bg-black px-6 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-black/90">
                    See your opportunity <ArrowRight className="h-4 w-4" />
                  </Link>
                  <a href="#how" className="inline-flex items-center justify-center rounded-full border border-black/[0.1] bg-white px-6 py-3.5 text-sm font-semibold text-black/70 shadow-sm hover:text-black">See how it works</a>
                </SignedOut>
                <SignedIn>
                  <Link href="/dashboard" className="inline-flex items-center justify-center gap-2 rounded-full bg-black px-6 py-3.5 text-sm font-semibold text-white">Open dashboard <ArrowRight className="h-4 w-4" /></Link>
                </SignedIn>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-black/40">
                {['WhatsApp first', 'Social publishing', 'Revenue attribution'].map((x) => <span key={x} className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5" />{x}</span>)}
              </div>
            </div>
            <MiniDashboard />
          </div>
        </section>

        <section id="how" className="bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/35">One operating system</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">Your restaurant finally has a growth loop.</h2>
            </div>
            <div className="mt-14 grid gap-4 md:grid-cols-3">
              {[
                { n: '01', icon: Sparkles, title: 'Find the opportunity', text: 'Flavourly watches bookings, demand, customers and your market to surface where revenue is being left behind.' },
                { n: '02', icon: Video, title: 'Create the campaign', text: 'The content engine turns the opportunity into a campaign, video, captions and platform-ready variations.' },
                { n: '03', icon: Zap, title: 'Publish and learn', text: 'Connect your social accounts, schedule the campaign, capture bookings and measure the money it created.' },
              ].map(({ n, icon: Icon, title, text }) => (
                <div key={n} className="rounded-[28px] border border-black/[0.07] bg-[#f7f7f9] p-7 sm:p-8">
                  <div className="flex items-center justify-between"><span className="text-xs font-bold text-black/25">{n}</span><Icon className="h-5 w-5 text-black/45" /></div>
                  <h3 className="mt-14 text-xl font-semibold tracking-tight">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-black/50">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="platform" className="bg-[#f5f5f7] py-20 sm:py-28">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:gap-20">
            <div className="relative overflow-hidden rounded-[32px] bg-black shadow-2xl">
              <Image src="/images/landing/kitchen-pass.jpg" alt="Chef working at a restaurant kitchen pass" width={1200} height={900} className="h-[440px] w-full object-cover opacity-70" />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
              <div className="absolute bottom-7 left-7 right-7 text-white">
                <div className="mb-4 flex items-center gap-2"><span className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur">One campaign</span><span className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur">5 channels</span></div>
                <p className="text-2xl font-semibold tracking-tight">Create once. Adapt everywhere.</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-white/60">Instagram, Facebook, TikTok, YouTube and LinkedIn — with each version adapted for the channel.</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/35">Marketing, without the marketing department</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">Your content works for the table, not the vanity metric.</h2>
              <div className="mt-8 space-y-4">
                {[
                  ['Content engine', 'Ideas, scripts, images, video and captions.'],
                  ['Auto publishing', 'Schedule and distribute from one place.'],
                  ['Guest conversion', 'Move attention into WhatsApp conversations and bookings.'],
                  ['Revenue proof', 'Connect campaigns to bookings and revenue.'],
                ].map(([a,b]) => <div key={a} className="flex gap-4 border-t border-black/[0.08] pt-4"><div className="mt-0.5 rounded-full bg-white p-2 shadow-sm"><Check className="h-3.5 w-3.5" /></div><div><p className="text-sm font-semibold">{a}</p><p className="mt-1 text-sm text-black/45">{b}</p></div></div>)}
              </div>
            </div>
          </div>
        </section>

        <section id="results" className="bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="rounded-[34px] bg-[#111113] p-7 text-white sm:p-12">
              <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-end">
                <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">The promise</p><h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">Stop measuring marketing by likes.</h2><p className="mt-5 max-w-md text-sm leading-6 text-white/55">Measure what matters: guests reached, conversations started, bookings captured and revenue recovered.</p></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[['Reach', 'attention'], ['Intent', 'conversations'], ['Bookings', 'customers'], ['Revenue', 'proof']].map(([a,b]) => <div key={a} className="rounded-2xl bg-white/[0.07] p-5"><p className="text-lg font-semibold">{a}</p><p className="mt-1 text-xs text-white/40">{b}</p></div>)}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#f5f5f7] py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 text-center sm:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/35">Ready when you are</p>
            <h2 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">Give your restaurant a growth engine.</h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-black/50">Start with one restaurant. Connect WhatsApp and your social accounts. Let Flavourly find the first opportunity.</p>
            <Link href="/sign-up" className="mt-8 inline-flex items-center gap-2 rounded-full bg-black px-7 py-4 text-sm font-semibold text-white shadow-xl hover:bg-black/90">Start your restaurant <ArrowRight className="h-4 w-4" /></Link>
            <div className="mt-10 flex flex-wrap justify-center gap-2">{channels.map((c) => <span key={c} className="rounded-full border border-black/[0.07] bg-white px-3.5 py-2 text-xs font-medium text-black/45">{c}</span>)}</div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/[0.06] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-xs text-black/40 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-3"><Image src="/logo.png" alt="Flavourly" width={96} height={54} className="h-7 w-auto" /><span>Restaurant Revenue Operating System</span></div>
          <div className="flex gap-5"><Link href="/pricing" className="hover:text-black">Pricing</Link><Link href="/privacy" className="hover:text-black">Privacy</Link><Link href="/terms" className="hover:text-black">Terms</Link></div>
        </div>
      </footer>
    </div>
  );
}
