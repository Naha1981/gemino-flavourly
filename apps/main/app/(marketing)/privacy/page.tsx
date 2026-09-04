import Link from 'next/link';
import Image from 'next/image';

export default function PrivacyPage() {
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
            <Link href="/terms" className="text-sm text-app-muted hover:text-white">Terms</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16 prose-invert">
        <h1 className="text-3xl font-bold">Privacy Policy (POPIA)</h1>
        <p className="text-app-faint">Effective date: August 2026 &mdash; Version 2026-08-v1</p>

        <p className="mt-8 text-app-muted">
          Flavourly (&quot;we&quot;, &quot;us&quot;) is committed to protecting the personal information of its restaurant tenants and their customers in compliance with the Protection of Personal Information Act (POPIA) of South Africa.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Data we collect</h2>
        <ul className="mt-3 space-y-2 text-app-muted">
          <li><strong className="text-app-fg">Restaurant profile:</strong> name, description, trading hours, address, menu content.</li>
          <li><strong className="text-app-fg">Customer contact details:</strong> phone number and name, captured when a customer messages your WhatsApp number.</li>
          <li><strong className="text-app-fg">Message history:</strong> inbound and outbound WhatsApp messages processed by the AI assistant.</li>
          <li><strong className="text-app-fg">Booking &amp; transaction data:</strong> reservation dates, party sizes, loyalty points, revenue estimates.</li>
          <li><strong className="text-app-fg">Technical data:</strong> IP address and user agent recorded at sign-up consent.</li>
        </ul>

        <h2 className="mt-10 text-2xl font-semibold">Purpose</h2>
        <p className="mt-3 text-app-muted">
          We collect and process this data solely to operate the Flavourly assistant on your behalf: answering customer messages, managing bookings and waitlists, running loyalty and reactivation campaigns, generating market intelligence, and reporting on your revenue. We do not sell personal information to third parties.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Legal basis &amp; consent</h2>
        <p className="mt-3 text-app-muted">
          Processing is necessary for the performance of the service you request. Where required, we obtain explicit consent &mdash; recorded with timestamp and version &mdash; at sign-up. You may withdraw consent at any time (see Your rights).
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Data retention</h2>
        <p className="mt-3 text-app-muted">
          Personal information is retained only as long as needed to provide the service or as required by law. Message history and customer profiles are kept for the duration of your active subscription plus 90 days. Upon account closure, personal data is deleted within 30 days, except where retention is required by law.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Your rights (POPIA)</h2>
        <ul className="mt-3 space-y-2 text-app-muted">
          <li><strong className="text-app-fg">Access:</strong> request a copy of the personal information we hold.</li>
          <li><strong className="text-app-fg">Correction:</strong> request correction of inaccurate information.</li>
          <li><strong className="text-app-fg">Deletion:</strong> request deletion of your personal information.</li>
          <li><strong className="text-app-fg">Objection:</strong> object to processing, including automated messaging opt-out via STOP.</li>
          <li><strong className="text-app-fg">Complaint:</strong> lodge a complaint with the Information Regulator of South Africa.</li>
        </ul>

        <h2 className="mt-10 text-2xl font-semibold">Customer opt-out</h2>
        <p className="mt-3 text-app-muted">
          Your customers can opt out of automated messages at any time by replying <strong>STOP</strong> on WhatsApp. This is enforced immediately and applies across all automated messaging.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Security</h2>
        <p className="mt-3 text-app-muted">
          Data is encrypted in transit (TLS) and at rest. API keys are encrypted with AES-256-GCM. Access is scoped per tenant and authenticated via Clerk.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Contact</h2>
        <p className="mt-3 text-app-muted">
          For privacy requests or questions, contact our Information Officer at <a href="mailto:privacy@flavourly.app" className="text-emerald-400 hover:text-emerald-300">privacy@flavourly.app</a>.
        </p>
      </main>

      <footer className="border-t border-app-border/80 py-8">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 text-sm text-app-faint">
          <span>&copy; {new Date().getFullYear()} Flavourly</span>
          <div className="flex gap-5">
            <Link href="/pricing" className="hover:text-app-muted">Pricing</Link>
            <Link href="/terms" className="hover:text-app-muted">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
