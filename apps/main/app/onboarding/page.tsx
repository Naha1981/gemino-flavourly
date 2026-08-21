import Link from 'next/link';
import { CheckCircle2, ArrowRight } from 'lucide-react';

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-lg space-y-8 rounded-lg border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-50">Welcome to Gemino AI</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Your account is ready. Let&apos;s connect your WhatsApp and configure your AI assistant.
          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
            <h2 className="text-sm font-semibold text-zinc-200">Step 1: Link WhatsApp</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Scan the QR code with your restaurant&apos;s WhatsApp to connect.
            </p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
            <h2 className="text-sm font-semibold text-zinc-200">Step 2: Configure Greetings</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Set up your welcome message and AI personality.
            </p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
            <h2 className="text-sm font-semibold text-zinc-200">Step 3: Go Live</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Test a message and watch Gemino reply instantly.
            </p>
          </div>
        </div>

        <div className="pt-4">
          <Link
            href="/dashboard"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400"
          >
            Continue to Dashboard <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
