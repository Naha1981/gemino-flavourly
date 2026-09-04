import Link from 'next/link';
import Image from 'next/image';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-app-bg text-app-fg antialiased">
      <header className="border-b border-app-border/80">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="flex items-center">
            <Image src="/logo.png" alt="Flavourly" width={144} height={36} className="h-9 w-auto" priority />
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/" className="text-sm text-app-muted hover:text-white">Home</Link>
            <Link href="/pricing" className="text-sm text-app-muted hover:text-white">Pricing</Link>
            <Link href="/privacy" className="text-sm text-app-muted hover:text-white">Privacy</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold">Terms of Service</h1>
        <p className="text-app-faint">Effective date: August 2026</p>

        <h2 className="mt-10 text-2xl font-semibold">1. Service</h2>
        <p className="mt-3 text-app-muted">
          Flavourly provides a multi-tenant WhatsApp AI assistant platform for restaurants. The service includes AI-powered customer replies, booking and waitlist management, loyalty and reactivation campaigns, market intelligence, and marketing tools.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">2. Accounts</h2>
        <p className="mt-3 text-app-muted">
          You are responsible for maintaining the security of your account and WhatsApp connection. Each account is scoped to a single tenant (restaurant). Multi-location operators require a Group plan or per-location add-on.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">3. Billing</h2>
        <p className="mt-3 text-app-muted">
          Pricing is as published on our pricing page, billed monthly in ZAR via PayFast. A one-time setup fee applies per plan. Annual billing receives two months free. AI messaging is paused when a subscription is past-due or canceled; the dashboard remains accessible in read-only mode.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">4. Fair use &amp; compliance</h2>
        <p className="mt-3 text-app-muted">
          You agree to use the service in compliance with POPIA and all applicable laws. Automated messaging must respect customer opt-out (STOP). We provide a master kill-switch to pause all AI messaging instantly.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">5. Data</h2>
        <p className="mt-3 text-app-muted">
          You own your customer data. We process it solely to provide the service. Our Privacy Policy (POPIA) describes our data practices in detail.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">6. Availability</h2>
        <p className="mt-3 text-app-muted">
          The service is provided &quot;as is&quot; without uptime guarantees beyond commercially reasonable efforts. The WhatsApp connection depends on the WhatsApp Web protocol, which is subject to change by Meta.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">7. Liability</h2>
        <p className="mt-3 text-app-muted">
          To the maximum extent permitted by law, Flavourly&apos;s liability is limited to the fees paid in the 12 months preceding the claim. We are not liable for indirect or consequential damages.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">8. Changes</h2>
        <p className="mt-3 text-app-muted">
          We may update these terms with reasonable notice. Continued use after changes constitutes acceptance.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">9. Contact</h2>
        <p className="mt-3 text-app-muted">
          Questions about these terms: <a href="mailto:legal@flavourly.app" className="text-emerald-400 hover:text-emerald-300">legal@flavourly.app</a>.
        </p>
      </main>

      <footer className="border-t border-app-border/80 py-8">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 text-sm text-app-faint">
          <span>&copy; {new Date().getFullYear()} Flavourly</span>
          <div className="flex gap-5">
            <Link href="/pricing" className="hover:text-app-muted">Pricing</Link>
            <Link href="/privacy" className="hover:text-app-muted">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
