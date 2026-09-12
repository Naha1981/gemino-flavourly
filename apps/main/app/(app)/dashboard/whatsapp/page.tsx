'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { CheckCircle2, Loader2, Phone, QrCode, RefreshCw, WifiOff } from 'lucide-react';
import {
  qrPhase,
  shouldAutoKick,
  shouldClearEngineError,
  MAX_AUTO_KICKS,
  type QrPhase,
} from '@/lib/whatsapp/qr-freshness';

type Status = {
  isConnected: boolean;
  phoneNumber: string | null;
  qrCode: string | null;
  status?: 'unlinked' | 'connecting' | 'connected' | 'disconnected';
  operatorOnline?: boolean | null;
};

const POLL_MS = 3_000;
const TICK_MS = 1_000;
const QR_SIZE = 288;

export default function WhatsAppConnectPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engineErrorAt, setEngineErrorAt] = useState<number | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lastQrChangeAt, setLastQrChangeAt] = useState<number | null>(null);
  const [kicks, setKicks] = useState(0);
  const [pairingMode, setPairingMode] = useState<'qr' | 'phone'>('qr');
  const [pairingPhone, setPairingPhone] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<number | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

  const lastKickAt = useRef<number | null>(null);
  const kickInFlight = useRef(false);
  const prevQr = useRef<string | null>(null);
  const pollAttempted = useRef(false);

  const applyStatus = useCallback((next: Status) => {
    setStatus(next);
    if ((next.qrCode ?? null) !== prevQr.current) {
      prevQr.current = next.qrCode ?? null;
      setLastQrChangeAt(Date.now());
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/status', { cache: 'no-store' });
      const data: Status & { error?: string } = await res.json().catch(() => ({}) as Status);
      if (res.ok) {
        applyStatus(data);
        setStatusError(null);
        setWaking(data.operatorOnline === false);
        return;
      }

      // The status endpoint intentionally returns a useful partial state on
      // central-Operator failures. Keep it visible so the page says WAKING
      // instead of falling back to a silent generic spinner.
      if (typeof data === 'object' && data !== null && ('operatorOnline' in data || 'status' in data)) {
        applyStatus({
          isConnected: !!data.isConnected,
          phoneNumber: data.phoneNumber ?? null,
          qrCode: data.qrCode ?? null,
          status: data.status ?? 'unlinked',
          operatorOnline: data.operatorOnline ?? false,
        });
      }
      setWaking(data.operatorOnline === false);
      setStatusError(`Couldn’t read WhatsApp status (HTTP ${res.status}): ${data?.error || 'unknown error'}`);
    } catch {
      setWaking(true);
      setStatusError('Network error while reading WhatsApp status — retrying automatically.');
    } finally {
      pollAttempted.current = true;
    }
  }, [applyStatus]);

  const kick = useCallback(async () => {
    if (kickInFlight.current) return;
    kickInFlight.current = true;
    lastKickAt.current = Date.now();
    setKicks((k) => k + 1);
    try {
      const res = await fetch('/api/whatsapp/connect', { method: 'POST' });
      const data: {
        ok?: boolean;
        state?: 'waking' | 'ready';
        waking?: boolean;
        isConnected?: boolean;
        qrCode?: string | null;
        phoneNumber?: string | null;
        error?: string;
      } = await res.json().catch(() => ({}));

      if (res.status === 202 || data.waking || data.state === 'waking') {
        setWaking(true);
        setError(null);
        setEngineErrorAt(null);
        return;
      }

      if (!res.ok) {
        setWaking(false);
        setError(data?.error || 'Could not reach the WhatsApp Operator.');
        setEngineErrorAt(Date.now());
        return;
      }

      setWaking(false);
      setError(null);
      setEngineErrorAt(null);
      if (data && (data.qrCode || data.isConnected)) {
        applyStatus({
          isConnected: !!data.isConnected,
          phoneNumber: data.phoneNumber ?? status?.phoneNumber ?? null,
          qrCode: data.qrCode ?? null,
          status: data.isConnected ? 'connected' : 'connecting',
          operatorOnline: true,
        });
      }
    } catch {
      setWaking(true);
      setError('The central WhatsApp Operator is waking or temporarily unreachable. Retrying automatically.');
      setEngineErrorAt(Date.now());
    } finally {
      kickInFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyStatus]);

  const requestPairingCode = useCallback(async () => {
    const digits = pairingPhone.replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(digits)) {
      setPairingError('Enter the WhatsApp number in international format, including the country code.');
      return;
    }
    setPairingLoading(true);
    setPairingError(null);
    setPairingCode(null);
    try {
      const res = await fetch('/api/whatsapp/pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: digits }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPairingError(data?.error || 'Could not request a pairing code.');
        return;
      }
      setPairingCode(data?.pairingCodeDisplay || data?.pairingCode || null);
      setPairingExpiresAt(data?.expiresAt ? Date.parse(data.expiresAt) : Date.now() + 60_000);
    } catch {
      setPairingError('Network error while requesting the pairing code.');
    } finally {
      setPairingLoading(false);
    }
  }, [pairingPhone]);

  useEffect(() => {
    refresh();
    const poll = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  const phase = useMemo<QrPhase>(() => {
    if (!status) return 'waiting';
    return qrPhase({ isConnected: status.isConnected, qrCode: status.qrCode ?? null, lastQrChangeAt, now });
  }, [status, lastQrChangeAt, now]);

  useEffect(() => {
    if (error === null) return;
    if (shouldClearEngineError({ engineErrorAt, stateImproved: phase === 'fresh' || phase === 'connected', now })) {
      setError(null);
      setEngineErrorAt(null);
    }
  }, [now, error, engineErrorAt, phase]);

  useEffect(() => {
    if (shouldAutoKick({ phase, pollAttempted: pollAttempted.current, lastKickAt: lastKickAt.current, kicks, now })) {
      kick();
    }
  }, [phase, kicks, now, kick]);

  useEffect(() => {
    if (pairingExpiresAt !== null && pairingExpiresAt <= now) {
      setPairingCode(null);
      setPairingExpiresAt(null);
    }
    if (status?.isConnected) {
      setPairingCode(null);
      setPairingExpiresAt(null);
    }
  }, [now, pairingExpiresAt, status?.isConnected]);

  const gaveUp = kicks >= MAX_AUTO_KICKS && phase !== 'connected' && phase !== 'fresh';
  const secsSinceRefresh = lastQrChangeAt !== null ? Math.max(0, Math.floor((now - lastQrChangeAt) / 1000)) : null;
  const secsPairingLeft = pairingExpiresAt !== null ? Math.max(0, Math.ceil((pairingExpiresAt - now) / 1000)) : null;
  const engineOffline = status?.operatorOnline === false;
  const loggedOut = status?.status === 'disconnected' && !status.isConnected;

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">WhatsApp Connection</h1>
        <p className="mt-1 text-sm text-zinc-400">Link your restaurant&apos;s WhatsApp number to start receiving AI replies.</p>
      </div>

      {statusError && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{statusError}</div>}
      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300" data-testid="engine-error">
          <span className="font-semibold">WhatsApp Operator error:</span> {error}
        </div>
      )}
      {waking && !status?.isConnected && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-200" data-testid="operator-waking">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            <span>The central WhatsApp Operator is waking from standby. Gemino will keep retrying automatically until it is ready.</span>
          </div>
        </div>
      )}
      {engineOffline && !status?.isConnected && !waking && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-200" data-testid="engine-offline">
          <div className="flex items-center gap-2">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            <span>The central WhatsApp Operator is not responding right now. It may be waking from standby, or the OPERATOR_URL/configuration may need attention.</span>
          </div>
        </div>
      )}
      {loggedOut && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-200" data-testid="logged-out">
          The WhatsApp session is disconnected. Start a fresh pairing below to reconnect it.
        </div>
      )}

      {status?.isConnected ? (
        <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
            <div>
              <h2 className="font-semibold text-emerald-300">WhatsApp Connected</h2>
              <p className="text-sm text-zinc-400 mt-0.5">Active on {status.phoneNumber ?? 'your number'}. The AI is answering your customers now.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-zinc-800 p-2.5"><QrCode className="h-5 w-5 text-emerald-400" /></div>
            <div>
              <h2 className="font-semibold text-zinc-50">Connect your WhatsApp</h2>
              <p className="text-sm text-zinc-400">Use the same WhatsApp number you already use for your business.</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
            <button type="button" onClick={() => setPairingMode('qr')} className={`rounded-md px-3 py-2 text-sm font-medium ${pairingMode === 'qr' ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <QrCode className="mr-2 inline h-4 w-4" /> Scan QR
            </button>
            <button type="button" onClick={() => setPairingMode('phone')} className={`rounded-md px-3 py-2 text-sm font-medium ${pairingMode === 'phone' ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <Phone className="mr-2 inline h-4 w-4" /> Use phone number
            </button>
          </div>

          {pairingMode === 'qr' ? (
            status?.qrCode ? (
              <div className="mt-6 flex flex-col items-center gap-4 bg-zinc-950/60 p-6 rounded-lg border border-zinc-800/80">
                <div className="relative rounded-lg bg-white p-4 shadow-md" data-testid="qr-frame" data-qr-phase={phase}>
                  {status.qrCode.startsWith('data:image') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={status.qrCode} alt="WhatsApp QR code" width={QR_SIZE} height={QR_SIZE} />
                  ) : (
                    <QRCodeCanvas value={status.qrCode.trim()} size={QR_SIZE} bgColor="#ffffff" fgColor="#000000" level="L" title="WhatsApp pairing code" />
                  )}
                  {phase === 'stale' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/85">
                      <Loader2 className="h-5 w-5 animate-spin text-zinc-700" />
                      <span className="text-xs font-medium text-zinc-700">Getting a fresh code…</span>
                    </div>
                  )}
                </div>

                <ol className="list-decimal space-y-1.5 pl-4 text-sm text-zinc-400 max-w-sm">
                  <li>Open WhatsApp on your phone.</li>
                  <li>Go to Settings → Linked Devices → Link a Device.</li>
                  <li>Scan this code — it refreshes automatically.</li>
                </ol>

                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <RefreshCw className="h-3 w-3" aria-hidden />
                  {phase === 'stale' ? <span>Code expired — requesting a new one</span> : secsSinceRefresh !== null ? <span>Code refreshed {secsSinceRefresh}s ago · new one every ~20s</span> : <span>New code every ~20 seconds</span>}
                </div>
              </div>
            ) : (
              <div className="mt-6 flex flex-col items-center gap-4 bg-zinc-950/60 p-6 rounded-lg border border-zinc-800/80">
                {gaveUp ? (
                  <>
                    <p className="text-sm text-zinc-400 max-w-sm text-center">The central WhatsApp Operator isn&apos;t responding. Try again when it is available.</p>
                    <button onClick={() => { setKicks(0); kick(); }} className="flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 shadow-sm">
                      <QrCode className="h-4 w-4" /> Retry QR Code
                    </button>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
                    <p className="text-sm text-zinc-400" data-testid="starting-message">{waking ? 'Waking the central WhatsApp Operator…' : 'Starting the central WhatsApp Operator…'}</p>
                    <p className="text-xs text-zinc-600">{waking ? 'Render may need a little time to bring the shared service out of standby. Gemino will retry automatically.' : status?.status === 'connecting' ? 'Preparing your pairing code.' : 'Requesting a pairing session.'}</p>
                    <button onClick={kick} className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300">Request a code manually</button>
                  </>
                )}
              </div>
            )
          ) : (
            <div className="mt-6 space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-6">
              <div>
                <label htmlFor="whatsapp-pairing-phone" className="block text-sm font-medium text-zinc-200">WhatsApp phone number</label>
                <p className="mt-1 text-xs text-zinc-500">Use international format, for example 27821234567. No password or WhatsApp PIN is requested.</p>
              </div>
              <div className="flex gap-2">
                <input id="whatsapp-pairing-phone" value={pairingPhone} onChange={(e) => setPairingPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="27821234567" className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-emerald-500 placeholder:text-zinc-600 focus:ring-2" />
                <button type="button" onClick={requestPairingCode} disabled={pairingLoading} className="rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60">
                  {pairingLoading ? 'Requesting…' : 'Get code'}
                </button>
              </div>
              {pairingError && <p className="text-sm text-red-300">{pairingError}</p>}
              {pairingCode && (
                <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-5 text-center">
                  <p className="text-xs uppercase tracking-wide text-emerald-300">Pairing code</p>
                  <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.18em] text-zinc-50" data-testid="pairing-code">{pairingCode}</p>
                  <p className="mt-2 text-xs text-zinc-500">Expires in {secsPairingLeft ?? 0}s. In WhatsApp: Linked Devices → Link a device → Link with phone number instead.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
