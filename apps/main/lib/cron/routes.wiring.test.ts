import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Integration-level guard tests.
 *
 * The unit tests in auth.test.ts / verify.test.ts prove the decision
 * functions are correct. They prove nothing about whether the routes
 * actually CALL them — a route that forgot the guard would still pass.
 *
 * Fully invoking the route handlers here is impractical: importing them
 * pulls in lib/db, which throws at import time unless DATABASE_URL is set,
 * plus the Clerk and Drizzle runtimes. Rather than mock the entire stack
 * (which would test the mocks, not the boundary), these tests assert the
 * wiring directly against route source: every cron route must invoke the
 * shared guard and return early on failure, and the webhook route must
 * verify the signature before doing any work.
 *
 * This is deliberately a wiring check, not a substitute for the unit
 * tests above. Its job is to fail loudly if someone adds a new cron route
 * without the guard, or removes the check from an existing one.
 */

const CRON_DIR = join(HERE, '..', '..', 'app', 'api', 'cron');
const WEBHOOK_ROUTE = join(HERE, '..', '..', 'app', 'api', 'webhooks', 'whatsapp', 'route.ts');

/**
 * Strip comments so prose mentioning an old pattern (e.g. a comment
 * explaining that the NODE_ENV bypass was removed) cannot be mistaken for
 * live code.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Return just the body of an exported handler. Ordering assertions must be
 * scoped to the handler itself: helper functions declared earlier in the
 * file appear at a lower string index but do not run first.
 */
function handlerBody(src: string, method: string): string {
  const start = src.indexOf(`export async function ${method}(`);
  if (start === -1) return '';
  return src.slice(start);
}

function cronRouteFiles(): string[] {
  return readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(CRON_DIR, e.name, 'route.ts'));
}

describe('every cron route is wired to the shared guard', () => {
  const files = cronRouteFiles();

  test('at least one cron route exists (guards against a silent empty scan)', () => {
    assert.ok(files.length > 0, 'no cron routes found — did the directory move?');
  });

  for (const file of files) {
    const name = file.split('/').slice(-2).join('/');
    const src = readFileSync(file, 'utf8');

    test(`${name} imports assertCronAuthorized`, () => {
      assert.match(src, /import\s*\{[^}]*assertCronAuthorized[^}]*\}\s*from\s*'@\/lib\/cron\/auth'/);
    });

    test(`${name} calls the guard and returns early on rejection`, () => {
      assert.match(src, /assertCronAuthorized\(req\)/);
      assert.match(src, /if\s*\(\s*authError\s*\)\s*return\s+authError\s*;/);
    });

    test(`${name} calls the guard before touching the database`, () => {
      const code = stripComments(src);
      const body = handlerBody(code, 'GET') || handlerBody(code, 'POST');
      assert.notEqual(body, '', 'no exported GET/POST handler found');
      const guardAt = body.indexOf('assertCronAuthorized(req)');
      const dbAt = body.search(/\bdb\s*\./);
      assert.ok(guardAt > -1, 'guard call not found inside the handler');
      if (dbAt > -1) {
        assert.ok(guardAt < dbAt, 'database is accessed before the authorization check');
      }
    });

    test(`${name} does not read a secret from the query string`, () => {
      assert.doesNotMatch(
        stripComments(src),
        /searchParams\.get\(\s*['"](key|secret|token|cron_secret)['"]\s*\)/i,
      );
    });
  }
});

describe('cron auth utility does not accept query-string credentials', () => {
  const src =
    readFileSync(join(HERE, 'auth.ts'), 'utf8') +
    readFileSync(join(HERE, 'authorize.ts'), 'utf8');

  test('no searchParams usage remains in the guard', () => {
    assert.doesNotMatch(stripComments(src), /searchParams/);
  });

  test('the guard never logs the secret value', () => {
    // Interpolating the secret into a template literal would leak it to logs.
    assert.doesNotMatch(src, /console\.[a-z]+\([^)]*\$\{\s*secret\s*\}/);
  });
});

describe('webhook route verifies the signature before processing', () => {
  const src = readFileSync(WEBHOOK_ROUTE, 'utf8');

  test('imports the shared verifier', () => {
    assert.match(src, /import\s*\{[^}]*verifyWebhookSignature[^}]*\}\s*from\s*'@\/lib\/webhook\/verify'/);
  });

  test('rejects with 401 when verification fails', () => {
    assert.match(src, /if\s*\(\s*!verifyWebhookSignature\(/);
    assert.match(src, /status:\s*401/);
  });

  test('verifies before parsing or persisting the payload', () => {
    // Scoped to the POST body: helpers defined above POST sit at a lower
    // string index but execute only when called, after verification.
    const body = handlerBody(stripComments(src), 'POST');
    assert.notEqual(body, '', 'no exported POST handler found');
    const verifyAt = body.indexOf('verifyWebhookSignature(');
    const parseAt = body.indexOf('JSON.parse(');
    const dbAt = body.search(/\bdb\s*\./);
    assert.ok(verifyAt > -1, 'verification call not found in POST');
    if (parseAt > -1) assert.ok(verifyAt < parseAt, 'payload parsed before verification');
    if (dbAt > -1) assert.ok(verifyAt < dbAt, 'database touched before verification');
  });

  test('the old NODE_ENV-based bypass is gone from the route', () => {
    // Comments are stripped first: the route retains a comment describing
    // the removed bypass, which is documentation, not a live code path.
    assert.doesNotMatch(stripComments(src), /NODE_ENV\s*!==\s*'production'/);
  });
});
