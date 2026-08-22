import crypto from 'crypto';
import { getAccountBinding, persistPlatformEvent, markPlatformEvent } from '../db/client.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const DEFAULT_WEBHOOK_URL = process.env.MAIN_APP_WEBHOOK_URL || 'http://localhost:3000/api/webhooks/whatsapp';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  logger.fatal('WEBHOOK_SECRET is not set — refusing to forward WhatsApp messages with a weak/guessable signature.');
}

const RETRY_DELAYS_MS = [200, 600, 1800];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function forwardToMain(waAccountId: string, msg: any) {
  if (!WEBHOOK_SECRET) {
    logger.error({ waAccountId }, 'Dropping inbound message: WEBHOOK_SECRET not configured');
    return;
  }

  const binding = await getAccountBinding(waAccountId);
  const targetUrl = binding?.webhook_url || DEFAULT_WEBHOOK_URL;
  const tenantId = binding?.tenant_id || undefined;
  const appId = binding?.app_id || 'gemino';

  const payload = {
    waAccountId,
    tenantId,
    appId,
    message: msg,
    timestamp: Date.now(),
  };

  const eventId = await persistPlatformEvent(waAccountId, payload);
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-signature': signature,
          'User-Agent': 'Gemino-WhatsApp-Operator/1.0',
        },
        body,
      });

      if (response.ok) {
        await markPlatformEvent(eventId, 'forwarded', attempt, null);
        logger.info(`Forwarded inbound message for ${waAccountId} to ${targetUrl} (attempt ${attempt})`);
        return;
      }

      lastError = `HTTP ${response.status}`;
      logger.warn(`Webhook forward to ${targetUrl} returned ${response.status} (attempt ${attempt})`);
      if (response.status < 500) {
        await markPlatformEvent(eventId, 'failed', attempt, lastError);
        return;
      }
    } catch (err: any) {
      lastError = err.message || 'network error';
      logger.error(`Error forwarding webhook to ${targetUrl}: ${lastError} (attempt ${attempt})`);
    }

    if (attempt < 3) {
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
  }

  await markPlatformEvent(eventId, 'failed', 3, lastError);
}
