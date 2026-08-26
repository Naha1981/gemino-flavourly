import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 antialiased">
      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="flex items-center">
            <img src="/logo.png" alt="Flavourly" className="h-9 w-auto" />
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/" className="text-sm text-zinc-300 hover:text-white">Home</Link>
            <Link href="/pricing" className="text-sm text-zinc-300 hover:text-white">Pricing</Link>
            <Link href="/privacy" className="text-sm text-zinc-300 hover:text-white">Privacy</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold">Terms of Service</h1>
        <p className="text-zinc-500">Effective date: August 2026</p>

        <h2 className="mt-10 text-2xl font-semibold">1. Service</h2>
        <p className="mt-3 text-zinc-300">
          Flavourly provides a multi-tenant WhatsApp AI assistant platform for restaurants. The service includes AI-powered customer replies, booking and waitlist management, loyalty and reactivation campaigns, market intelligence, and marketing tools.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">2. Accounts</h2>
        <p className="mt-3 text-zinc-300">
          You are responsible for maintaining the security of your account and WhatsApp connection. Each account is scoped to a single tenant (restaurant). Multi-location operators require a Group plan or per-location add-on.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">3. Billing</h2>
        <p className="mt-3 text-zinc-300">
          Pricing is as published on our pricing page, billed monthly in ZAR via PayFast. A one-time setup fee applies per plan. Annual billing receives two months free. AI messaging is paused when a subscription is past-due or canceled; the dashboard remains accessible in read-only mode.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">4. Fair use &amp; compliance</h2>
        <p className="mt-3 text-zinc-300">
          You agree to use the service in compliance with POPIA and all applicable laws. Automated messaging must respect customer opt-out (STOP). We provide a master kill-switch to pause all AI messaging instantly.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">5. Data</h2>
        <p className="mt-3 text-zinc-300">
          You own your customer data. We process it solely to provide the service. Our Privacy Policy (POPIA) describes our data practices in detail.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">6. Availability</h2>
        <p className="mt-3 text-zinc-300">
          The service is provided &quot;as is&quot; without uptime guarantees beyond commercially reasonable efforts. The WhatsApp connection depends on the WhatsApp Web protocol, which is subject to change by Meta.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">7. Liability</h2>
        <p className="mt-3 text-zinc-300">
          To the maximum extent permitted by law, Flavourly&apos;s liability is limited to the fees paid in the 12 months preceding the claim. We are not liable for indirect or consequential damages.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">8. Changes</h2>
        <p className="mt-3 text-zinc-300">
          We may update these terms with reasonable notice. Continued use after changes constitutes acceptance.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">9. Contact</h2>
        <p className="mt-3 text-zinc-300">
          Questions about these terms: <a href="mailto:legal@flavourly.app" className="text-emerald-400 hover:text-emerald-300">legal@flavourly.app</a>.
        </p>
      </main>

      <footer className="border-t border-zinc-800/80 py-8">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 text-sm text-zinc-500">
          <span>&copy; {new Date().getFullYear()} Flavourly</span>
          <div className="flex gap-5">
            <Link href="/pricing" className="hover:text-zinc-300">Pricing</Link>
            <Link href="/privacy" className="hover:text-zinc-300">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
