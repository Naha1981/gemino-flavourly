import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { getWaAccount, updateWaAccount, getConnectedAccountIds, getPostgresAuthState } from '../db/client.js';
import { forwardToMain } from '../webhook/forward.js';
import pino from 'pino';
import {
  nextReconnectDelayMs,
  isZombieLinkingSocket,
  QR_STALE_MS,
} from './linking-policy.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Global socket registry: waAccountId -> live Baileys WASocket
const sockets = new Map<string, any>();

// Tracks which accounts have a fully open (handshake-complete) socket
// right now, separate from just "a socket object exists" — a socket can
// exist in `sockets` while still mid-handshake after a fresh connect.
const openAccounts = new Set<string>();

// De-dupes concurrent startWhatsAppSocket calls for the same account. At
// low volume this race was rare; at 100 concurrent tenants with regular
// reconnects, a reconnect timer firing at the same moment as an on-demand
// start (from /start or sendMessage's own on-demand start) is a routine
// occurrence, not an edge case. Without this, both callers would each
// create a brand-new Baileys socket for the same account, the second
// silently overwriting the first in `sockets` with no cleanup of the
// first one's listeners — the classic setup for DisconnectReason.conflict
// / an unexpected device unlink.
const connectingLocks = new Map<string, Promise<StartSocketResult>>();

// Per-account reconnect attempt counter, for capped exponential backoff so a
// persistently broken account doesn't hammer WhatsApp's servers forever.
// The CAP differs by phase — see linking-policy.ts: linked accounts back off
// up to 5 minutes, but an account still in the QR-linking phase caps at 15s
// because a human is standing at the connection screen with their phone out.
const reconnectAttempts = new Map<string, number>();

function nextReconnectDelay(waAccountId: string, linked: boolean): number {
  const attempts = (reconnectAttempts.get(waAccountId) ?? 0) + 1;
  reconnectAttempts.set(waAccountId, attempts);
  return nextReconnectDelayMs(attempts, linked);
}

/**
 * Best-effort teardown of a socket we no longer trust: deregister it first
 * (so its events fail the identity guard and get ignored), then detach the
 * event listeners and close the underlying WebSocket. Used by the zombie
 * eviction path in doStartWhatsAppSocket.
 */
function detachSocket(waAccountId: string, sock: any): void {
  if (sockets.get(waAccountId) === sock) {
    sockets.delete(waAccountId);
  }
  openAccounts.delete(waAccountId);
  try {
    sock.ev?.removeAllListeners?.();
  } catch {
    /* best effort */
  }
  try {
    const closing = sock.end?.(undefined);
    if (closing && typeof closing.catch === 'function') closing.catch(() => {});
  } catch {
    /* best effort */
  }
}

interface StartSocketResult {
  success: true;
  isConnected: boolean;
  qrCode: string | null;
  phoneNumber: string | null;
}

/**
 * Connection lifecycle state machine, one call per 'connection.update' event.
 *
 * Two guards matter here that the old inline version lacked:
 *
 * 1. SOCKET IDENTITY: if THIS socket is no longer the one registered in
 *    `sockets` (it was replaced by a newer /start, /send on-demand start, or
 *    a reconnect timer), its events must be ignored completely. A stale
 *    socket's 'close' used to delete the NEW socket's open flag and schedule
 *    yet another reconnect — two live sockets kicking each other off
 *    (DisconnectReason.conflict / 440), plus a WebSocket/fd leak, plus two
 *    sockets interleaving writes to the same session creds (Signal key
 *    corruption).
 *
 * 2. RECONNECT POLICY: only errors that indicate a TRANSIENT drop are
 *    retried. loggedOut (440 is connectionReplaced) and badSession (500)
 *    are permanent conditions — retrying a replaced socket is exactly what
 *    creates the conflict loop, and retrying a corrupt session with the
 *    same creds loops forever. Both stop and free the slot instead.
 */
async function handleConnectionUpdate(
  waAccountId: string,
  sock: any,
  update: Partial<{ connection: string; lastDisconnect: any; qr: string }>
): Promise<void> {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    logger.info(`New QR code generated for account ${waAccountId}`);
    await updateWaAccount(waAccountId, {
      qrCode: qr,
      isConnected: false,
      status: 'connecting',
    });
  }

  if (connection === 'open') {
    reconnectAttempts.delete(waAccountId);
    openAccounts.add(waAccountId);
    const phoneNumber = sock.user?.id?.split(':')[0] || sock.user?.id || null;
    logger.info(`WhatsApp connected successfully for account: ${waAccountId} (Phone: ${phoneNumber})`);

    await updateWaAccount(waAccountId, {
      isConnected: true,
      qrCode: null,
      phoneNumber,
      status: 'connected',
      lastConnectedAt: new Date(),
    });
  }

  if (connection === 'close') {
    // Identity guard — see the docblock above.
    if (sockets.get(waAccountId) !== sock) {
      logger.warn(
        `Ignoring close of STALE socket for account ${waAccountId} (a newer socket owns the slot).`
      );
      return;
    }

    openAccounts.delete(waAccountId);
    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
    const permanent =
      statusCode === DisconnectReason.loggedOut ||
      statusCode === DisconnectReason.connectionReplaced ||
      statusCode === DisconnectReason.badSession;

    // "Was this account ever linked?" decides the reconnect cadence. A
    // linked account resumes automatically and can afford patient
    // backoff; a never-linked account is mid QR-pairing and a human is
    // actively waiting — long backoff there is what froze the pairing
    // screen on one expired code in production (2026-08-31).
    let wasLinked = false;
    try {
      const acct = await getWaAccount(waAccountId);
      wasLinked = !!(acct?.last_connected_at || acct?.session_creds);
    } catch {
      // DB unavailable — assume linking (faster retries, safe default).
    }

    if (!permanent) {
      // Remove the dead socket from the registry NOW so /send's on-demand
      // start can build a fresh one during the backoff window instead of
      // waiting out a 15s timeout on a socket that will never open again.
      sockets.delete(waAccountId);
      await updateWaAccount(waAccountId, {
        isConnected: false,
        // Clear the stored QR too: during the backoff window the code is
        // expired, and the dashboard used to keep showing it as scannable.
        qrCode: null,
        status: 'connecting',
      });
      const delay = nextReconnectDelay(waAccountId, wasLinked);
      logger.warn(
        `Connection closed for account ${waAccountId}. Status: ${statusCode}. Reconnecting in ${delay}ms.`
      );
      setTimeout(() => {
        startWhatsAppSocket(waAccountId).catch((err) =>
          logger.error(`Auto-reconnect failed for ${waAccountId}: ${err.message}`)
        );
      }, delay);
    } else {
      logger.error(
        `Account ${waAccountId} closed permanently (status ${statusCode}). Socket removed; no reconnect.`
      );
      reconnectAttempts.delete(waAccountId);
      sockets.delete(waAccountId);
      await updateWaAccount(waAccountId, {
        isConnected: false,
        qrCode: null,
        status:
          statusCode === DisconnectReason.badSession
            ? 'disconnected' // session corrupt — needs manual re-link, don't pretend it's unlinked-fresh
            : 'unlinked',
      });
    }
  }
}

export async function startWhatsAppSocket(waAccountId: string): Promise<StartSocketResult> {
  const existing = connectingLocks.get(waAccountId);
  if (existing) return existing;

  const attempt = doStartWhatsAppSocket(waAccountId).finally(() => {
    connectingLocks.delete(waAccountId);
  });
  connectingLocks.set(waAccountId, attempt);
  return attempt;
}

async function doStartWhatsAppSocket(waAccountId: string): Promise<StartSocketResult> {
  const account = await getWaAccount(waAccountId);
  if (!account) {
    throw new Error(`WhatsApp account ${waAccountId} not found in database`);
  }

  // A socket registered in `sockets` is either OPEN or mid-handshake —
  // closed sockets remove themselves from the map in their close handler
  // (see handleConnectionUpdate). So a registered socket must NEVER be
  // replaced by a second one: the old early-return
  // (`existingSock && account.is_connected`) let a second /start or /send
  // through whenever `is_connected` was stale, stacking a duplicate live
  // socket for the same account — the classic conflict/unlink spiral, and
  // two sockets interleaving writes to the same session creds (Signal key
  // corruption). Instead: return the open fast-path, otherwise WAIT for the
  // existing handshake to settle instead of creating a new socket.
  const existingSock = sockets.get(waAccountId);
  if (existingSock) {
    if (openAccounts.has(waAccountId) && account.is_connected) {
      return { success: true, isConnected: true, qrCode: null, phoneNumber: account.phone_number };
    }

    // ZOMBIE EVICTION (linking phase only): a registered socket that never
    // opened and whose account row shows no QR activity for >QR_STALE_MS
    // is silently dead — waiting for it (the old behaviour) froze the
    // pairing screen on one expired code while every /start politely
    // waited on the corpse. Evict it and build a fresh socket so the user
    // gets a live QR. Linked/mid-resume sockets are never evicted here.
    let fresh: Awaited<ReturnType<typeof getWaAccount>> = account;
    try {
      fresh = await getWaAccount(waAccountId);
    } catch {
      // fall back to the account read at function entry
    }
    const zombie = isZombieLinkingSocket({
      socketRegistered: true,
      open: openAccounts.has(waAccountId),
      linked: !!(fresh?.last_connected_at || fresh?.session_creds),
      qrCode: fresh?.qr_code ?? null,
      qrUpdatedAt: fresh?.updated_at ? new Date(fresh.updated_at) : null,
      now: new Date(),
    });
    if (!zombie) {
      return waitForStartResult(waAccountId);
    }
    logger.warn(
      `Evicting ZOMBIE linking socket for account ${waAccountId} (no QR activity >${Math.round(
        QR_STALE_MS / 1000
      )}s). Building a fresh socket for a live QR.`
    );
    detachSocket(waAccountId, existingSock);
    // fall through: create a replacement socket below.
  }

  const { state, saveCreds } = await getPostgresAuthState(waAccountId);

  logger.info(`Initializing Baileys WhatsApp socket for account: ${waAccountId}`);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Gemino Business OS', 'Chrome', '120.0.0.0'], // Prevents Meta device flagging
    syncFullHistory: false,
    markOnlineOnConnect: true,
    // Baileys' default lets the FIRST QR live 60s (qrTimeout || 60000 in
    // Socket/socket.js's genPairQR) with subsequent codes every 20s. A
    // 60s first code pairs badly with a dashboard that promises "new one
    // every ~20s" and flags staleness at 40s — the user would be told the
    // code is stale while it is still the only valid one. Pin the full
    // cadence to 20s: the pairing refs still last multiple cycles, and
    // ref exhaustion falls through to the normal linking reconnect.
    qrTimeout: 20_000,
    logger,
  });

  sockets.set(waAccountId, sock);
  openAccounts.delete(waAccountId);

  // A fresh socket means any qr_code still stored on the account is from a
  // PREVIOUS linking attempt (expired, or the process died mid-link). Clear
  // it now: the wait-loop below breaks on the FIRST non-null qr_code it
  // sees, so a stale value made it return an expired QR (~0ms) before the
  // new socket's real QR landed — the "code is no longer valid" support
  // symptom.
  try {
    await updateWaAccount(waAccountId, { qrCode: null, status: 'connecting' });
  } catch (err: any) {
    logger.error(`Failed to clear stale QR for account ${waAccountId}: ${err.message}`);
  }

  // 1. Connection Lifecycle Updates
  sock.ev.on('connection.update', async (update) => {
    // Baileys fires ev events without awaiting handlers, so every await in
    // here is an unhandled rejection if Postgres blips — Node 20 terminates
    // the process on an unhandled rejection, killing ALL tenants' sockets.
    try {
      await handleConnectionUpdate(waAccountId, sock, update);
    } catch (err: any) {
      logger.error(`connection.update handler failed for account ${waAccountId}: ${err.message}`);
    }
  });

  // 2. Incoming Messages Listener
  sock.ev.on('messages.upsert', async ({ messages: rawMessages, type }) => {
    if (type !== 'notify') return;

    try {
      for (const msg of rawMessages) {
        // Ignore messages sent by ourselves or without content
        if (!msg.message || msg.key.fromMe) continue;

        logger.info(`Received inbound message from ${msg.key.remoteJid} on account ${waAccountId}`);
        await forwardToMain(waAccountId, msg);
      }
    } catch (err: any) {
      logger.error(`messages.upsert handler failed for account ${waAccountId}: ${err.message}`);
    }
  });

  // 3. Credential updates
  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
    } catch (err: any) {
      // creds.update fires on nearly every message — a transient DB error
      // here used to crash the whole process.
      logger.error(`creds.update handler failed for account ${waAccountId}: ${err.message}`);
    }
  });

  return waitForStartResult(waAccountId);
}

/**
 * Give the socket a brief window to either open or produce a QR code before
 * responding, so callers (the /start route, the dashboard) get an accurate
 * snapshot instead of the pre-connection state. Bounded to 3s so a slow
 * handshake doesn't hang the HTTP request; the dashboard's separate polling
 * picks up the rest.
 */
async function waitForStartResult(waAccountId: string): Promise<StartSocketResult> {
  for (let i = 0; i < 6; i++) {
    if (openAccounts.has(waAccountId)) break;
    const fresh = await getWaAccount(waAccountId);
    if (fresh?.qr_code) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const fresh = await getWaAccount(waAccountId);
  return {
    success: true,
    isConnected: !!fresh?.is_connected,
    qrCode: fresh?.qr_code ?? null,
    phoneNumber: fresh?.phone_number ?? null,
  };
}

async function waitForSocketOpen(waAccountId: string, timeoutMs = 15_000): Promise<void> {
  if (openAccounts.has(waAccountId)) return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (openAccounts.has(waAccountId)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for WhatsApp socket ${waAccountId} to finish connecting`);
}

export async function sendMessage(waAccountId: string, to: string, text: string) {
  let sock = sockets.get(waAccountId);

  // If socket is not running in memory, try to spin it up
  if (!sock) {
    logger.info(`Socket not active in memory for ${waAccountId}. Initializing on-demand...`);
    await startWhatsAppSocket(waAccountId);
    sock = sockets.get(waAccountId);
  }

  if (!sock) {
    throw new Error(`WhatsApp socket for account ${waAccountId} could not be initialized`);
  }

  // Previously called sock.sendMessage() immediately after an on-demand
  // start, with no check that the handshake had actually completed —
  // the socket object exists as soon as makeWASocket() returns, well
  // before 'connection' === 'open' fires. Sending on a socket that's
  // still mid-handshake either silently fails or throws an opaque
  // Baileys error. Now waits for the connection to actually be open
  // (bounded, so a genuinely broken account fails fast with a clear
  // error instead of hanging).
  if (!openAccounts.has(waAccountId)) {
    await waitForSocketOpen(waAccountId);
  }

  // RE-FETCH the socket after waiting: the wait may have been satisfied by
  // a reconnect timer (or on-demand start) installing a NEW socket while
  // the local `sock` variable still references the closed one. Sending on
  // the stale object failed with an opaque Baileys error even though the
  // account was actually connected by then.
  sock = sockets.get(waAccountId);
  if (!sock) {
    throw new Error(`WhatsApp socket for account ${waAccountId} disappeared before dispatch`);
  }

  // Recipient normalization. A full JID (anything containing '@' —
  // `...@s.whatsapp.net`, group `...@g.us`, LID `...@lid`) is passed through
  // as-is: the old code stripped EVERYTHING but digits and re-appended
  // `@s.whatsapp.net`, which silently rewrote group/LID addresses to a
  // nonexistent user. A bare phone number (digits, optionally starting
  // with '+') is normalized to `digits@s.whatsapp.net`.
  const jid = to.includes('@')
    ? to.trim()
    : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
  if (!/^\S+@\S+$/.test(jid)) {
    throw new Error(`Invalid recipient "${to}" — cannot resolve to a WhatsApp JID`);
  }

  logger.info(`Dispatching outbound message via account ${waAccountId} to ${jid}`);
  return await sock.sendMessage(jid, { text });
}

/**
 * Number of WhatsApp accounts this process currently carries LIVE (open)
 * connections for.
 *
 * Used by the /ready probe to distinguish "the process is alive" from
 * "the process can actually carry WhatsApp traffic". Counts openAccounts —
 * sockets.size also includes sockets sitting in the map mid-handshake or
 * awaiting reconnect, so it reported every tenant as active during
 * precisely the outage windows the probe exists to catch.
 */
export function getActiveSocketCount(): number {
  return openAccounts.size;
}

export function getSocketStatus(waAccountId: string) {
  const sock = sockets.get(waAccountId);
  return {
    inMemory: !!sock,
    open: openAccounts.has(waAccountId),
    user: sock?.user || null,
  };
}

/**
 * Called once on process boot. Any account marked `is_connected = true`
 * before this instance last stopped (Render redeploys, idle spin-downs)
 * gets its socket re-established automatically from the persisted
 * session — no QR re-scan needed, now that the Signal key store actually
 * survives restarts.
 */
export async function resumeConnectedAccounts(): Promise<void> {
  const ids = await getConnectedAccountIds();
  logger.info(`Resuming ${ids.length} previously connected WhatsApp account(s) on boot`);

  for (const waAccountId of ids) {
    try {
      await startWhatsAppSocket(waAccountId);
    } catch (err: any) {
      logger.error(`Failed to resume account ${waAccountId} on boot: ${err.message}`);
    }
  }
}

