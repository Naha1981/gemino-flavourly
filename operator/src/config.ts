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
  if (missing.length === 0) return { ok: true, missing: [] };
  return { ok: false, missing, error: formatMissingEnvError(missing) };
}
