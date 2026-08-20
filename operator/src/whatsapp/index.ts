import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { getWaAccount, updateWaAccount, getConnectedAccountIds, getPostgresAuthState } from '../db/client.js';
import { forwardToMain } from '../webhook/forward.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Global socket registry: waAccountId -> live Baileys WASocket
const sockets = new Map<string, any>();

// Per-account reconnect attempt counter, for capped exponential backoff so a
// persistently broken account doesn't hammer WhatsApp's servers forever.
const reconnectAttempts = new Map<string, number>();
const MAX_RECONNECT_DELAY_MS = 5 * 60_000;

function nextReconnectDelay(waAccountId: string): number {
  const attempts = (reconnectAttempts.get(waAccountId) ?? 0) + 1;
  reconnectAttempts.set(waAccountId, attempts);
  return Math.min(5_000 * 2 ** (attempts - 1), MAX_RECONNECT_DELAY_MS);
}

export async function startWhatsAppSocket(waAccountId: string) {
  const account = await getWaAccount(waAccountId);
  if (!account) {
    throw new Error(`WhatsApp account ${waAccountId} not found in database`);
  }

  // If already connected and socket is alive, return immediately
  const existingSock = sockets.get(waAccountId);
  if (existingSock && account.is_connected) {
    return { success: true, isConnected: true, phoneNumber: account.phone_number };
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

  return {
    success: true,
    isConnected: account.is_connected,
    qrCode: account.qr_code,
    phoneNumber: account.phone_number,
  };
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

  // Normalize recipient JID e.g. 27821234567 -> 27821234567@s.whatsapp.net
  const cleaned = to.replace(/\D/g, '');
  const jid = cleaned.includes('@s.whatsapp.net') ? cleaned : `${cleaned}@s.whatsapp.net`;

  logger.info(`Dispatching outbound message via account ${waAccountId} to ${jid}`);
  return await sock.sendMessage(jid, { text });
}

export function getSocketStatus(waAccountId: string) {
  const sock = sockets.get(waAccountId);
  return {
    inMemory: !!sock,
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
