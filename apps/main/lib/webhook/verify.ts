import crypto from 'crypto';

/**
 * HMAC-SHA256 verification for inbound WhatsApp operator webhooks.
 *
 * Extracted from app/api/webhooks/whatsapp/route.ts so the security
 * boundary can be unit-tested directly. The signing counterpart lives in
 * operator/src/webhook/forward.ts, which sends the digest in the
 * `x-webhook-signature` header as lowercase hex.
 *
 * Fails CLOSED in every ambiguous case:
 *   - WEBHOOK_SECRET unset            -> reject (unless the explicit,
 *                                        narrowly-scoped local-dev escape
 *                                        hatch below is enabled)
 *   - signature header missing        -> reject
 *   - signature malformed / not hex   -> reject
 *   - payload modified after signing  -> reject (digest mismatch)
 *   - valid signature                 -> accept
 *
 * WHY THE PREVIOUS `NODE_ENV !== 'production'` CHECK WAS REPLACED
 * ---------------------------------------------------------------
 * The old code returned `process.env.NODE_ENV !== 'production'` when the
 * secret was missing, i.e. "no secret configured means accept every
 * unsigned request". That is a broad, environment-derived authentication
 * bypass and it failed OPEN by default: NODE_ENV is undefined under a bare
 * `node`/test process and in many container and CI images, so the
 * condition evaluated to `true` and verification was skipped entirely
 * wherever the variable simply had not been set. Security must not depend
 * on a variable whose absence is indistinguishable from development.
 *
 * The replacement keeps local development usable without weakening
 * production:
 *   - it requires a dedicated opt-in variable
 *     (ALLOW_UNSIGNED_WEBHOOKS=true) that exists for no other purpose, so
 *     it cannot be switched on as a side effect of some other setting;
 *   - it is hard-disabled whenever NODE_ENV === 'production' OR the
 *     platform marks the deployment as production (VERCEL_ENV), so setting
 *     it on a production deployment does nothing at all;
 *   - it only applies when NO secret is configured — if a secret exists,
 *     signatures are always verified, in every environment.
 */

/** True only for a deliberately-enabled, non-production local dev run. */
function unsignedWebhooksExplicitlyAllowed(env: NodeJS.ProcessEnv): boolean {
  // Hard block: never allow this on anything the platform calls production,
  // regardless of what else is configured.
  if (env.NODE_ENV === 'production') return false;
  if (env.VERCEL_ENV === 'production') return false;

  return env.ALLOW_UNSIGNED_WEBHOOKS === 'true';
}

/**
 * @param rawBody   exact request body bytes as received, before JSON.parse
 * @param signature value of the `x-webhook-signature` header
 * @param env       injectable for tests; defaults to the real environment
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const secret = env.WEBHOOK_SECRET;

  if (!secret) {
    // Fail closed by default. The only way through is the explicit,
    // production-impossible local-dev escape hatch documented above.
    return unsignedWebhooksExplicitlyAllowed(env);
  }

  if (typeof signature !== 'string' || signature.length === 0) return false;

  // Reject anything that is not a clean lowercase-hex digest before doing
  // any buffer work. Buffer.from(x, 'hex') silently truncates on invalid
  // input, which could otherwise make a malformed signature compare equal
  // to a short prefix.
  if (!/^[0-9a-f]+$/i.test(signature)) return false;

  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(signature, 'hex');

    // timingSafeEqual throws on length mismatch, so this must be checked
    // first. Length is not secret (it is fixed by SHA-256), so an early
    // return here leaks nothing.
    if (expectedBuf.length !== providedBuf.length) return false;

    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}
