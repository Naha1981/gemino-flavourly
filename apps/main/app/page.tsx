import Link from 'next/link';
import {
  MessageSquare,
  Zap,
  ShieldCheck,
  QrCode,
  Users,
  BarChart3,
  Bot,
  ArrowRight,
  Sparkles,
  Layers,
} from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between selection:bg-zinc-800">
      {/* Navigation Header */}
      <header className="border-b border-zinc-800/80 backdrop-blur-md sticky top-0 z-50 bg-zinc-950/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-zinc-100 text-zinc-950 flex items-center justify-center font-bold text-lg shadow-sm">
              G
            </div>
            <span className="font-semibold text-lg tracking-tight text-zinc-50">Gemino AI</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800 text-emerald-400 font-medium">
              v1.0 Live
            </span>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors font-medium"
            >
              Super Admin
            </Link>
            <Link
              href="/dashboard"
              className="px-4 py-2 text-xs font-medium bg-zinc-100 text-zinc-950 rounded-md hover:bg-zinc-200 transition-all flex items-center gap-1.5 shadow-sm"
            >
              Launch Dashboard
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="max-w-5xl mx-auto px-6 pt-24 pb-20 text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-800 bg-zinc-900/60 text-zinc-300 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Direct Linked-Devices WhatsApp WebSocket Architecture</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight text-zinc-100 max-w-4xl mx-auto leading-[1.15]">
            Autonomous WhatsApp Operations & AI Concierge for Modern Businesses
          </h1>

          <p className="text-zinc-400 text-lg sm:text-xl max-w-2xl mx-auto font-normal leading-relaxed">
            Zero per-message Twilio fees. Persistent 24/7 Baileys Linked Device sockets. Multi-tenant table bookings, instant waitlist dispatch, and loyalty automation.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-6 py-3.5 text-sm font-medium bg-zinc-100 text-zinc-950 rounded-lg hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-md"
            >
              <QrCode className="w-4 h-4" />
              Connect WhatsApp Account
            </Link>
            <Link
              href="/admin"
              className="w-full sm:w-auto px-6 py-3.5 text-sm font-medium bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-lg hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Platform Super Admin
            </Link>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-xl border border-zinc-800/80 bg-zinc-900/40 space-y-3">
              <div className="p-2.5 w-fit rounded-lg bg-zinc-800/80 text-zinc-200">
                <Bot className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold text-zinc-100">Direct Linked Devices</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Connect real WhatsApp numbers via QR scan. Persistent background socket daemon on Render with Postgres credential synchronization.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-zinc-800/80 bg-zinc-900/40 space-y-3">
              <div className="p-2.5 w-fit rounded-lg bg-zinc-800/80 text-zinc-200">
                <ShieldCheck className="w-5 h-5 text-blue-400" />
              </div>
              <h3 className="text-base font-semibold text-zinc-100">Outbox Pattern & HMAC</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Guaranteed outbound delivery with exponential retry backoff. Webhooks signed with HMAC-SHA256 and POPIA opt-out compliance.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-zinc-800/80 bg-zinc-900/40 space-y-3">
              <div className="p-2.5 w-fit rounded-lg bg-zinc-800/80 text-zinc-200">
                <Layers className="w-5 h-5 text-purple-400" />
              </div>
              <h3 className="text-base font-semibold text-zinc-100">Multi-Tenant Isolation</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                One shared operator routes incoming messages to infinite isolated tenants and independent app instances seamlessly.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/80 py-8 px-6 text-center text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} Gemino Multi-Tenant WhatsApp Platform. Production Grade.</p>
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="hover:text-zinc-300 transition-colors">
              Tenant Portal
            </Link>
            <Link href="/admin" className="hover:text-zinc-300 transition-colors">
              Super Admin
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
