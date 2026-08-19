import crypto from 'crypto';
import { getAccountBinding } from '../db/client.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const DEFAULT_WEBHOOK_URL = process.env.MAIN_APP_WEBHOOK_URL || 'http://localhost:3000/api/webhooks/whatsapp';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'secret';

export async function forwardToMain(waAccountId: string, msg: any) {
  // 1. Check if this account has an explicit binding to an app/tenant
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

  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

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

    if (!response.ok) {
      logger.warn(
        `Webhook forward to ${targetUrl} returned HTTP status ${response.status}`
      );
    } else {
      logger.info(`Successfully forwarded inbound message for account ${waAccountId} to ${targetUrl}`);
    }
  } catch (err: any) {
    logger.error(`Error forwarding webhook to ${targetUrl}: ${err.message}`);
  }
}
