import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * G0.2 integration tests: the operator PROCESS must refuse to start.
 *
 * The unit tests in config.test.ts prove the decision function is
 * correct. They cannot prove index.ts actually calls it, exits non-zero,
 * or — most importantly — that it fails BEFORE binding the HTTP port.
 * These tests boot the real entrypoint in a child process and assert on
 * its observable behaviour.
 *
 * Only the failure paths are booted. A successful start is deliberately
 * NOT tested by launching the server: that would open a real WhatsApp
 * socket and connect to a database. Startup ordering for the success
 * path is asserted by source inspection instead (see the final suite).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OPERATOR_DIR = join(HERE, '..');
const SOURCE_ENTRYPOINT = join(OPERATOR_DIR, 'src', 'index.ts');
const BUILT_ENTRYPOINT = join(OPERATOR_DIR, 'dist', 'index.js');

/**
 * These tests boot the COMPILED entrypoint (dist/index.js) — exactly the
 * artefact `npm start` runs in production — rather than the TypeScript
 * source. The source uses '.js' import specifiers (correct for an
 * emitting NodeNext build), which Node cannot resolve when executing the
 * .ts file directly. Booting the source would therefore crash on module
 * resolution and could be mistaken for a successful fail-fast.
 *
 * If dist/ is stale or absent the suite fails loudly rather than
 * silently passing against nothing.
 */
if (!existsSync(BUILT_ENTRYPOINT)) {
  throw new Error(
    `${BUILT_ENTRYPOINT} not found. Run \`npm run build\` in operator/ before these tests.`
  );
}

/** Run the operator entrypoint with a controlled environment. */
function bootOperator(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, ['--no-warnings', BUILT_ENTRYPOINT], {
    cwd: OPERATOR_DIR,
    encoding: 'utf8',
    // A fail-fast exit takes well under a second. This cap exists so a
    // regression that lets the server START (instead of exiting) surfaces
    // quickly as a timeout rather than hanging the whole suite.
    timeout: 5_000,
    // SIGKILL, not the default SIGTERM: index.ts installs a graceful
    // SIGTERM handler that waits on server.close() and pool.end(). With
    // an unreachable database that shutdown can itself hang, so a
    // regression would stall the suite instead of failing it.
    killSignal: 'SIGKILL',
    env: {
      // A bare environment: PATH only, plus whatever the test supplies.
      // dotenv's config() runs in index.ts, but there is no .env file in
      // the repo, so nothing is loaded from disk.
      PATH: process.env.PATH,
      ...env,
    } as NodeJS.ProcessEnv,
  });
}

const PLACEHOLDERS = {
  DATABASE_URL: 'postgresql://user:placeholder@127.0.0.1:1/db',
  WEBHOOK_SECRET: 'placeholder-webhook-secret',
  OPERATOR_API_KEY: 'placeholder-operator-api-key',
};

describe('operator refuses to start on invalid configuration', () => {
  test('exits non-zero when all required variables are missing', () => {
    const r = bootOperator({});
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stderr: ${r.stderr}`);
    // Guard against a false pass: an exit code of 1 caused by a crash
    // (e.g. module resolution) is NOT the fail-fast behaviour under test.
    const output = r.stdout + r.stderr;
    assert.match(output, /Refusing to start/);
    assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|SyntaxError|ReferenceError/);
  });

  for (const name of Object.keys(PLACEHOLDERS) as (keyof typeof PLACEHOLDERS)[]) {
    test(`exits non-zero when only ${name} is missing`, () => {
      const env: Record<string, string | undefined> = { ...PLACEHOLDERS };
      delete env[name];
      const r = bootOperator(env);
      assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stderr: ${r.stderr}`);
      assert.match(r.stdout + r.stderr, new RegExp(name));
    });

    test(`exits non-zero when ${name} is blank`, () => {
      const r = bootOperator({ ...PLACEHOLDERS, [name]: '' });
      assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stderr: ${r.stderr}`);
      assert.match(r.stdout + r.stderr, new RegExp(name));
    });
  }

  test('never prints a configured secret value while failing', () => {
    const r = bootOperator({
      DATABASE_URL: 'postgresql://u:SUPERSECRETPASSWORD@host/db',
      WEBHOOK_SECRET: 'DISTINCTIVE-SECRET-VALUE',
      // OPERATOR_API_KEY missing -> triggers the failure
    });
    const output = r.stdout + r.stderr;
    assert.equal(r.status, 1);
    assert.doesNotMatch(output, /SUPERSECRETPASSWORD/);
    assert.doesNotMatch(output, /DISTINCTIVE-SECRET-VALUE/);
    assert.match(output, /OPERATOR_API_KEY/);
  });

  test('does NOT report itself as listening before failing', () => {
    const output = (() => {
      const r = bootOperator({});
      return r.stdout + r.stderr;
    })();
    // index.ts logs "listening on port" from inside the listen callback.
    // Its absence is evidence the server never bound a port.
    assert.doesNotMatch(output, /listening on port/i);
    assert.doesNotMatch(output, /Health check available/i);
  });
});

describe('validation is ordered before any side effect', () => {
  // Comments are stripped first: index.ts contains a comment explaining
  // the ordering that mentions './db/client.js' by name, and prose must
  // not be mistaken for a live import.
  const src = readFileSync(SOURCE_ENTRYPOINT, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  test('validateConfig runs before app.listen', () => {
    const validateAt = src.indexOf('validateConfig(');
    const listenAt = src.indexOf('app.listen(');
    assert.ok(validateAt > -1, 'validateConfig call not found');
    assert.ok(listenAt > -1, 'app.listen call not found');
    assert.ok(validateAt < listenAt, 'config is validated after the server starts listening');
  });

  test('validateConfig runs before the db client is imported', () => {
    // Importing ./db/client.js constructs a pg Pool as a side effect, so
    // it must not happen until configuration is known to be valid.
    const validateAt = src.indexOf('validateConfig(');
    const dbImportAt = src.indexOf("./db/client.js");
    assert.ok(dbImportAt > -1, 'db client import not found');
    assert.ok(validateAt < dbImportAt, 'db client imported before configuration was validated');
  });

  test('a failed validation exits rather than continuing', () => {
    assert.match(src, /process\.exit\(1\)/);
  });
});
