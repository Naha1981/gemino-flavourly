import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { getWaAccount, updateWaAccount, getConnectedAccountIds, getPostgresAuthState } from '../db/client.js';
import { forwardToMain } from '../webhook/forward.js';
import pino from 'pino';

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
const reconnectAttempts = new Map<string, number>();
const MAX_RECONNECT_DELAY_MS = 5 * 60_000;

function nextReconnectDelay(waAccountId: string): number {
  const attempts = (reconnectAttempts.get(waAccountId) ?? 0) + 1;
  reconnectAttempts.set(waAccountId, attempts);
  return Math.min(5_000 * 2 ** (attempts - 1), MAX_RECONNECT_DELAY_MS);
}

interface StartSocketResult {
  success: true;
  isConnected: boolean;
  qrCode: string | null;
  phoneNumber: string | null;
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

  // If already connected and socket is alive, return immediately
  const existingSock = sockets.get(waAccountId);
  if (existingSock && account.is_connected) {
    return { success: true, isConnected: true, qrCode: null, phoneNumber: account.phone_number };
  }

  const { state, saveCreds } = await getPostgresAuthState(waAccountId);

  logger.info(`Initializing Baileys WhatsApp socket for account: ${waAccountId}`);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Gemino Business OS', 'Chrome', '120.0.0.0'], // Prevents Meta device flagging
    syncFullHistory: false,
    markOnlineOnConnect: true,
    logger,
  });

  sockets.set(waAccountId, sock);
  openAccounts.delete(waAccountId);

  // 1. Connection Lifecycle Updates
  sock.ev.on('connection.update', async (update) => {
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
      openAccounts.delete(waAccountId);
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        await updateWaAccount(waAccountId, {
          isConnected: false,
          status: 'connecting',
        });
        const delay = nextReconnectDelay(waAccountId);
        logger.warn(
          `Connection closed for account ${waAccountId}. Status: ${statusCode}. Reconnecting in ${delay}ms.`
        );
        setTimeout(() => {
          startWhatsAppSocket(waAccountId).catch((err) =>
            logger.error(`Auto-reconnect failed for ${waAccountId}: ${err.message}`)
          );
        }, delay);
      } else {
        logger.error(`Account ${waAccountId} logged out. Socket removed.`);
        reconnectAttempts.delete(waAccountId);
        await updateWaAccount(waAccountId, {
          isConnected: false,
          qrCode: null,
          status: 'unlinked',
        });
        sockets.delete(waAccountId);
      }
    }
  });

  // 2. Incoming Messages Listener
  sock.ev.on('messages.upsert', async ({ messages: rawMessages, type }) => {
    if (type !== 'notify') return;

    for (const msg of rawMessages) {
      // Ignore messages sent by ourselves or without content
      if (!msg.message || msg.key.fromMe) continue;

      logger.info(`Received inbound message from ${msg.key.remoteJid} on account ${waAccountId}`);
      await forwardToMain(waAccountId, msg);
    }
  });

  // 3. Credential updates
  sock.ev.on('creds.update', async () => {
    await saveCreds();
  });

  // Give the socket a brief window to either open or produce a QR code
  // before responding, so callers (the /start route, the dashboard) get
  // an accurate snapshot instead of the pre-connection state captured
  // before any of this ran. Previously this returned `account` as read
  // at the very top of the function — before the socket existed — so a
  // first-ever connect always reported isConnected: false, qrCode: null
  // regardless of what actually happened a moment later. Bounded to 3s
  // so a slow handshake doesn't hang the HTTP request; the dashboard's
  // separate polling picks up the rest.
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

  // Normalize recipient JID e.g. 27821234567 -> 27821234567@s.whatsapp.net
  const raw = String(to);
  const jid = raw.includes('@s.whatsapp.net') ? raw : `${raw.replace(/\D/g, '')}@s.whatsapp.net`;

  logger.info(`Dispatching outbound message via account ${waAccountId} to ${jid}`);
  return await sock.sendMessage(jid, { text });
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

