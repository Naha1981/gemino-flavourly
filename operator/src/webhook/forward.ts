import crypto from 'crypto';
import { getAccountBinding } from '../db/client.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const DEFAULT_WEBHOOK_URL = process.env.MAIN_APP_WEBHOOK_URL || 'http://localhost:3000/api/webhooks/whatsapp';

// Previously fell back to the literal string 'secret' if WEBHOOK_SECRET
// was unset — meaning a misconfigured operator would silently sign every
// forwarded message with a publicly-known value instead of refusing to
// start. WEBHOOK_SECRET is already required in operator/src/index.ts's
// boot-time check, so this should never actually be hit in a running
// process; it's a second line of defense against that check being
// bypassed or the boot check itself changing later.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  logger.fatal('WEBHOOK_SECRET is not set — refusing to forward WhatsApp messages with a weak/guessable signature.');
}

export async function forwardToMain(waAccountId: string, msg: any) {
  if (!WEBHOOK_SECRET) {
    logger.error({ waAccountId }, 'Dropping inbound message: WEBHOOK_SECRET not configured');
    return;
  }

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

  // Retry on 5xx responses and network failures (fetch throwing) — a
  // single Vercel cold start or a transient blip previously meant this
  // message was gone for good: one failed attempt, logged, dropped,
  // with no second try. A 4xx (bad signature, malformed payload) is not
  // retried since a retry can't fix a request that's wrong by
  // construction — only failures that are plausibly transient are.
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [1000, 3000, 7000]; // ~1s, 3s, 7s between attempts

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-signature': signature,
          'User-Agent': 'Gemino-WhatsApp-Operator/1.0',
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) {
        logger.info(`Forwarded inbound message for account ${waAccountId} to ${targetUrl} (attempt ${attempt}/${MAX_ATTEMPTS})`);
        return;
      }

      if (response.status < 500) {
        // Client-side error — the main app rejected this request outright
        // (bad signature, malformed body). Retrying won't help.
        logger.error(`Webhook forward to ${targetUrl} rejected with HTTP ${response.status} (not retrying, not a transient failure): ${(await response.text()).slice(0, 300)}`);
        return;
      }

      logger.warn(`Webhook forward to ${targetUrl} returned HTTP ${response.status} on attempt ${attempt}/${MAX_ATTEMPTS}`);
    } catch (err: any) {
      logger.warn(`Webhook forward to ${targetUrl} failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${err.message}`);
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt - 1]));
    }
  }

  logger.error(`Gave up forwarding inbound message for account ${waAccountId} to ${targetUrl} after ${MAX_ATTEMPTS} attempts — this message is lost.`);
}
