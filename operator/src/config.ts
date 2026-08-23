/**
 * Boot-time configuration contract for the operator.
 *
 * The operator is a long-running Render service. Before this module
 * existed it would start, bind its port and report a healthy /health
 * (which only pings Postgres) even when required configuration was
 * missing — and then fail silently at request time:
 *
 *   - WEBHOOK_SECRET unset   -> every inbound WhatsApp message is dropped
 *                               by forwardToMain(), with nothing but a log
 *                               line. The pipeline is dead while Render
 *                               reports the service as up.
 *   - OPERATOR_API_KEY unset -> every protected route answers 500, so the
 *                               main app cannot start sessions or send.
 *   - DATABASE_URL unset     -> pg falls back to libpq defaults and every
 *                               query fails at runtime.
 *
 * A missing secret is an operator error, not a request-time condition. It
 * should stop the deploy, not silently degrade the service. This module
 * turns all three into a hard, immediate boot failure.
 *
 * The check is deliberately pure and takes its environment as an argument
 * so it can be unit-tested directly, without spawning a process or
 * mutating the real environment.
 */

/**
 * Variables the operator cannot function without.
 *
 * Every entry here is already load-bearing in the existing code — this
 * list does not invent new requirements, it just enforces the ones the
 * runtime already assumes:
 *   DATABASE_URL     src/db/client.ts     (pg Pool connection string)
 *   WEBHOOK_SECRET   src/webhook/forward.ts (HMAC signing key)
 *   OPERATOR_API_KEY src/routes/index.ts  (x-api-key auth middleware)
 */
export const REQUIRED_ENV_VARS = ['DATABASE_URL', 'WEBHOOK_SECRET', 'OPERATOR_API_KEY'] as const;

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

/**
 * Returns the names of required variables that are absent, empty, or
 * whitespace-only.
 *
 * Blank counts as missing on purpose: `OPERATOR_API_KEY=` in a Render
 * dashboard or a stray `WEBHOOK_SECRET=" "` produces a defined-but-unusable
 * value. A blank secret would otherwise pass a naive `if (!process.env.X)`
 * only by accident, and a whitespace one would pass it outright.
 *
 * Returns NAMES ONLY — never values — so the result is always safe to log.
 */
export function findMissingEnvVars(env: NodeJS.ProcessEnv): RequiredEnvVar[] {
  return REQUIRED_ENV_VARS.filter((name) => {
    const value = env[name];
    return typeof value !== 'string' || value.trim() === '';
  });
}

/**
 * Human-readable failure message naming the missing variables.
 *
 * Contains variable NAMES only. No value, partial value, length or hash of
 * any secret is included, so this is safe to write to Render's logs.
 */
export function formatMissingEnvError(missing: readonly string[]): string {
  const list = missing.join(', ');
  const plural = missing.length === 1 ? 'variable' : 'variables';
  return (
    `Refusing to start: required environment ${plural} not set or blank: ${list}. ` +
    `Set ${missing.length === 1 ? 'it' : 'them'} in the Render service environment ` +
    `(Dashboard -> Environment) and redeploy.`
  );
}

/**
 * True when this process is running as a real deployment rather than a
 * developer's machine.
 *
 * Render sets RENDER=true on every service it runs, so a deployed
 * operator is detected even if NODE_ENV was never configured — the same
 * "absence must not mean development" reasoning applied to the webhook
 * verifier in G0.1.
 */
export function isProductionLike(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production' || env.RENDER === 'true';
}

/**
 * Rejects a webhook target that cannot possibly reach the main app from a
 * deployed operator.
 *
 * MAIN_APP_WEBHOOK_URL defaults to http://localhost:3000/... which is
 * correct locally and catastrophic in production: the operator POSTs every
 * inbound WhatsApp message to ITSELF, the request fails, it is retried
 * three times and then discarded — while /health still reports 200 and
 * Render shows the service as up. Every customer message is lost with no
 * visible error.
 *
 * The per-account `wa_account_bindings.webhook_url` override does not
 * rescue this: nothing in the codebase ever inserts into that table, so
 * the default is the only path actually used.
 *
 * Returns an error string, or null when the target is acceptable.
 */
export function findWebhookTargetError(env: NodeJS.ProcessEnv): string | null {
  if (!isProductionLike(env)) return null;

  const raw = env.MAIN_APP_WEBHOOK_URL;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return (
      'Refusing to start: MAIN_APP_WEBHOOK_URL is not set. In a deployed ' +
      'environment the operator would fall back to http://localhost:3000 and ' +
      'silently discard every inbound WhatsApp message. Set it to the public ' +
      'URL of the main app, e.g. https://your-app.example.com/api/webhooks/whatsapp.'
    );
  }

  let host: string;
  let protocol: string;
  try {
    const parsed = new URL(raw.trim());
    host = parsed.hostname.toLowerCase();
    protocol = parsed.protocol;
  } catch {
    return `Refusing to start: MAIN_APP_WEBHOOK_URL is not a valid URL. Set it to the public URL of the main app.`;
  }

  // Loopback and link-local addresses can never reach the main app from a
  // separate service. ::1 arrives from the URL parser bracketed.
  const loopback = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
  if (loopback.has(host) || host.endsWith('.localhost') || host === '169.254.169.254') {
    return (
      `Refusing to start: MAIN_APP_WEBHOOK_URL points at "${host}", which is not ` +
      'reachable from a deployed operator. Every inbound WhatsApp message would be ' +
      'silently discarded. Set it to the public URL of the main app.'
    );
  }

  if (protocol !== 'http:' && protocol !== 'https:') {
    return `Refusing to start: MAIN_APP_WEBHOOK_URL must use http or https, got "${protocol}".`;
  }

  return null;
}

/**
 * Validates configuration and returns the missing names.
 *
 * Kept separate from the process-exiting wrapper so tests can assert the
 * decision without killing the test runner.
 */
export function validateConfig(env: NodeJS.ProcessEnv): {
  ok: boolean;
  missing: RequiredEnvVar[];
  error?: string;
} {
  const missing = findMissingEnvVars(env);
  if (missing.length > 0) {
    return { ok: false, missing, error: formatMissingEnvError(missing) };
  }

  const webhookError = findWebhookTargetError(env);
  if (webhookError) {
    return { ok: false, missing: [], error: webhookError };
  }

  return { ok: true, missing: [] };
}
