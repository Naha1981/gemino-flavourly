'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { CheckCircle2, Loader2, QrCode, RefreshCw } from 'lucide-react';
import {
  qrPhase,
  shouldAutoKick,
  MAX_AUTO_KICKS,
  type QrPhase,
} from '@/lib/whatsapp/qr-freshness';

type Status = {
  isConnected: boolean;
  phoneNumber: string | null;
  qrCode: string | null;
  status?: 'unlinked' | 'connecting' | 'connected' | 'disconnected';
};

const POLL_MS = 3_000;
const TICK_MS = 1_000;
const QR_SIZE = 288;

export default function WhatsAppConnectPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Client clock, ticked every second — drives stale detection + the
  // "code refreshed Ns ago" chip without extra fetches.
  const [now, setNow] = useState(() => Date.now());
  const [lastQrChangeAt, setLastQrChangeAt] = useState<number | null>(null);
  const [kicks, setKicks] = useState(0);

  const lastKickAt = useRef<number | null>(null);
  const kickInFlight = useRef(false);
  const prevQr = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/status', { cache: 'no-store' });
      if (res.ok) {
        const next: Status = await res.json();
        setStatus(next);
        // Track when the CODE VALUE last changed — the freshness clock.
        // A re-fetch that returns the same string tells us nothing about
        // scanability; only a changed string does (Baileys re-emits ~20s).
        if ((next.qrCode ?? null) !== prevQr.current) {
          prevQr.current = next.qrCode ?? null;
          setLastQrChangeAt(Date.now());
        }
        setError(null);
      }
    } catch {
      // Transient network error — keep the last known status on screen.
    }
  }, []);

  const kick = useCallback(async () => {
    if (kickInFlight.current) return;
    kickInFlight.current = true;
    lastKickAt.current = Date.now();
    setKicks((k) => k + 1);
    try {
      const res = await fetch('/api/whatsapp/connect', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || 'Could not reach the WhatsApp engine.');
      }
    } catch {
      setError('Could not reach the WhatsApp engine.');
    } finally {
      kickInFlight.current = false;
    }
  }, []);

  // Poll the account state (QR string, connection) every 3s.
  useEffect(() => {
    refresh();
    const poll = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(poll);
  }, [refresh]);

  // One-second clock for freshness + auto-recovery decisions.
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  const phase = useMemo<QrPhase>(() => {
    if (!status) return 'waiting';
    return qrPhase({
      isConnected: status.isConnected,
      qrCode: status.qrCode ?? null,
      lastQrChangeAt,
      now,
    });
  }, [status, lastQrChangeAt, now]);

  // Auto-recovery: when the displayed code goes stale (operator paused,
  // redeploy, backoff window) re-kick the engine — rate-limited and
  // capped, so a hard-down engine degrades to the manual button instead
  // of a request loop. On first load this is also what auto-starts the
  // linking flow.
  useEffect(() => {
    if (!status) return;
    if (
      shouldAutoKick({
        phase,
        lastKickAt: lastKickAt.current,
        kicks,
        now,
      })
    ) {
      kick();
    }
  }, [phase, kicks, now, status, kick]);

  const gaveUp = kicks >= MAX_AUTO_KICKS && phase !== 'connected' && phase !== 'fresh';
  const secsSinceRefresh = lastQrChangeAt !== null ? Math.max(0, Math.floor((now - lastQrChangeAt) / 1000)) : null;

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
              <div
                className="relative rounded-lg bg-white p-4 shadow-md"
                data-testid="qr-frame"
                data-qr-phase={phase}
              >
                {/* Canvas, not SVG: the SVG variant failed to paint modules
                    in some production contexts. The canvas path draws
                    pixels directly; qrcode.react renders it at
                    size x devicePixelRatio internally, so it stays crisp on
                    HiDPI screens. Level L + 288px keeps modules large
                    enough for a phone camera at desk distance — the
                    operator's raw pairing string is the value encoded. */}
                {status.qrCode.startsWith('data:image') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={status.qrCode} alt="WhatsApp QR code" width={QR_SIZE} height={QR_SIZE} />
                ) : (
                  <QRCodeCanvas
                    value={status.qrCode.trim()}
                    size={QR_SIZE}
                    bgColor="#ffffff"
                    fgColor="#000000"
                    level="L"
                    title="WhatsApp pairing code"
                  />
                )}

                {phase === 'stale' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/85">
                    <Loader2 className="h-5 w-5 animate-spin text-zinc-700" />
                    <span className="text-xs font-medium text-zinc-700">Getting a fresh code…</span>
                  </div>
                )}
              </div>

              <ol className="list-decimal space-y-1.5 pl-4 text-sm text-zinc-400 max-w-sm">
                <li>Open WhatsApp on your phone</li>
                <li>Go to Settings → Linked Devices → Link a Device</li>
                <li>Scan this code — it refreshes automatically</li>
              </ol>

              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <RefreshCw className="h-3 w-3" aria-hidden />
                {phase === 'stale' ? (
                  <span>Code expired — requesting a new one</span>
                ) : secsSinceRefresh !== null ? (
                  <span>Code refreshed {secsSinceRefresh}s ago · new one every ~20s</span>
                ) : (
                  <span>New code every ~20 seconds</span>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center gap-4 bg-zinc-950/60 p-6 rounded-lg border border-zinc-800/80">
              {gaveUp ? (
                <>
                  <p className="text-sm text-zinc-400 max-w-sm text-center">
                    The WhatsApp engine isn&apos;t responding. It may be waking up from
                    standby — try again in a minute.
                  </p>
                  <button
                    onClick={() => {
                      setKicks(0);
                      kick();
                    }}
                    className="flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 shadow-sm"
                  >
                    <QrCode className="h-4 w-4" />
                    Retry QR Code
                  </button>
                </>
              ) : (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
                  <p className="text-sm text-zinc-400">Starting the WhatsApp engine…</p>
                  <button
                    onClick={kick}
                    className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
                  >
                    Getting a code manually
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
