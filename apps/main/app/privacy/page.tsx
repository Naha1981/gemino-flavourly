import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 antialiased">
      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-lg font-bold text-zinc-900">G</span>
            <span className="text-lg font-semibold tracking-tight">Gemino AI</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/" className="text-sm text-zinc-300 hover:text-white">Home</Link>
            <Link href="/pricing" className="text-sm text-zinc-300 hover:text-white">Pricing</Link>
            <Link href="/terms" className="text-sm text-zinc-300 hover:text-white">Terms</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16 prose-invert">
        <h1 className="text-3xl font-bold">Privacy Policy (POPIA)</h1>
        <p className="text-zinc-500">Effective date: August 2026 &mdash; Version 2026-08-v1</p>

        <p className="mt-8 text-zinc-300">
          Gemino AI (&quot;we&quot;, &quot;us&quot;) is committed to protecting the personal information of its restaurant tenants and their customers in compliance with the Protection of Personal Information Act (POPIA) of South Africa.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Data we collect</h2>
        <ul className="mt-3 space-y-2 text-zinc-300">
          <li><strong className="text-zinc-100">Restaurant profile:</strong> name, description, trading hours, address, menu content.</li>
          <li><strong className="text-zinc-100">Customer contact details:</strong> phone number and name, captured when a customer messages your WhatsApp number.</li>
          <li><strong className="text-zinc-100">Message history:</strong> inbound and outbound WhatsApp messages processed by the AI assistant.</li>
          <li><strong className="text-zinc-100">Booking &amp; transaction data:</strong> reservation dates, party sizes, loyalty points, revenue estimates.</li>
          <li><strong className="text-zinc-100">Technical data:</strong> IP address and user agent recorded at sign-up consent.</li>
        </ul>

        <h2 className="mt-10 text-2xl font-semibold">Purpose</h2>
        <p className="mt-3 text-zinc-300">
          We collect and process this data solely to operate the Gemino AI assistant on your behalf: answering customer messages, managing bookings and waitlists, running loyalty and reactivation campaigns, generating market intelligence, and reporting on your revenue. We do not sell personal information to third parties.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Legal basis &amp; consent</h2>
        <p className="mt-3 text-zinc-300">
          Processing is necessary for the performance of the service you request. Where required, we obtain explicit consent &mdash; recorded with timestamp and version &mdash; at sign-up. You may withdraw consent at any time (see Your rights).
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Data retention</h2>
        <p className="mt-3 text-zinc-300">
          Personal information is retained only as long as needed to provide the service or as required by law. Message history and customer profiles are kept for the duration of your active subscription plus 90 days. Upon account closure, personal data is deleted within 30 days, except where retention is required by law.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Your rights (POPIA)</h2>
        <ul className="mt-3 space-y-2 text-zinc-300">
          <li><strong className="text-zinc-100">Access:</strong> request a copy of the personal information we hold.</li>
          <li><strong className="text-zinc-100">Correction:</strong> request correction of inaccurate information.</li>
          <li><strong className="text-zinc-100">Deletion:</strong> request deletion of your personal information.</li>
          <li><strong className="text-zinc-100">Objection:</strong> object to processing, including automated messaging opt-out via STOP.</li>
          <li><strong className="text-zinc-100">Complaint:</strong> lodge a complaint with the Information Regulator of South Africa.</li>
        </ul>

        <h2 className="mt-10 text-2xl font-semibold">Customer opt-out</h2>
        <p className="mt-3 text-zinc-300">
          Your customers can opt out of automated messages at any time by replying <strong>STOP</strong> on WhatsApp. This is enforced immediately and applies across all automated messaging.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Security</h2>
        <p className="mt-3 text-zinc-300">
          Data is encrypted in transit (TLS) and at rest. API keys are encrypted with AES-256-GCM. Access is scoped per tenant and authenticated via Clerk.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Contact</h2>
        <p className="mt-3 text-zinc-300">
          For privacy requests or questions, contact our Information Officer at <a href="mailto:privacy@gemino.app" className="text-emerald-400 hover:text-emerald-300">privacy@gemino.app</a>.
        </p>
      </main>

      <footer className="border-t border-zinc-800/80 py-8">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 text-sm text-zinc-500">
          <span>&copy; {new Date().getFullYear()} Gemino AI</span>
          <div className="flex gap-5">
            <Link href="/pricing" className="hover:text-zinc-300">Pricing</Link>
            <Link href="/terms" className="hover:text-zinc-300">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
