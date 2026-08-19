'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Loader2, QrCode } from 'lucide-react';

type Status = { isConnected: boolean; phoneNumber: string | null; qrCode: string | null };

export default function WhatsAppConnectPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/whatsapp/status', { cache: 'no-store' });
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = window.setInterval(refresh, 3000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [refresh]);

  async function connect() {
    setConnecting(true);
    setError(null);
    const res = await fetch('/api/whatsapp/connect', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || 'Could not reach the WhatsApp engine.');
    }
    setConnecting(false);
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">WhatsApp Connection</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Link your restaurant&apos;s WhatsApp number to start receiving AI replies.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {status?.isConnected ? (
        <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
            <div>
              <h2 className="font-semibold text-emerald-300">WhatsApp Connected</h2>
              <p className="text-sm text-zinc-400 mt-0.5">
                Active on {status.phoneNumber ?? 'your number'}. The AI is answering your customers now.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-zinc-800 p-2.5">
              <QrCode className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="font-semibold text-zinc-50">Connect your WhatsApp</h2>
              <p className="text-sm text-zinc-400">Works exactly like linking WhatsApp Web.</p>
            </div>
          </div>

          {status?.qrCode ? (
            <div className="mt-6 flex flex-col items-center gap-4 bg-zinc-950/60 p-6 rounded-lg border border-zinc-800/80">
              <div className="rounded-lg bg-white p-4 shadow-md">
                <QRCodeSVG value={status.qrCode} size={220} />
              </div>
              <ol className="list-decimal space-y-1.5 pl-4 text-sm text-zinc-400 max-w-sm">
                <li>Open WhatsApp on your phone</li>
                <li>Go to Settings → Linked Devices → Link a Device</li>
                <li>Scan this code — it refreshes automatically</li>
              </ol>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-60 shadow-sm"
            >
              {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
              {connecting ? 'Starting WhatsApp engine…' : 'Get QR Code'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
