import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');

/**
 * Gate #3 wiring tests.
 *
 * cancellation-followup.test.ts runs the real decision logic and the real
 * cron orchestration against an in-memory reservations table. What it cannot
 * see is whether the cron route actually calls it, whether the Postgres
 * adapter asks the question the logic assumes, or whether the schema and
 * migrations agree with each other. These assertions pin those seams, in the
 * same style as lib/cron/routes.wiring.test.ts and the Gate #2 wiring tests:
 * executing the handlers would need Clerk and a live database, and mocking
 * that stack would test the mocks.
 */

const CRON_ROUTE = join(APP, 'api', 'cron', 'cancellation-followup', 'route.ts');
const STORE = join(HERE, 'cancellation-followup-store.ts');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0002_cancellation_followup.sql');
// The /api/migrate DDL was lifted verbatim out of the route handler into
// lib/db/migrate-ddl.ts so it can be EXECUTED by lib/db/migrate-execute.test.ts.
// These assertions check the same statements, now at their real home.
const MIGRATE_DDL_FILE = join(APP, '..', 'lib', 'db', 'migrate-ddl.ts');

/** Strip comments so prose describing behaviour is not mistaken for code. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

describe('seam 1: the cron route runs the follow-up logic behind the shared guard', () => {
  const src = code(CRON_ROUTE);
  const handler = from(src, 'export async function GET(');

  test('uses the same CRON_SECRET guard as every other cron', () => {
    assert.match(src, /import\s*\{[^}]*assertCronAuthorized[^}]*\}\s*from\s*'@\/lib\/cron\/auth'/);
    assert.match(handler, /assertCronAuthorized\(req\)/);
    assert.match(handler, /if\s*\(\s*authError\s*\)\s*return\s+authError\s*;/);
  });

  test('authenticates before touching the database', () => {
    assert.ok(handler.indexOf('assertCronAuthorized(req)') < handler.search(/\bdb\s*\./));
  });

  test('runs the shared logic with the Drizzle store', () => {
    assert.match(handler, /runCancellationFollowupCron\(\s*drizzleCancellationFollowupStore\s*,/);
  });

  test('respects the global AI kill-switch', () => {
    assert.match(handler, /masterAiSwitch\s*===\s*false/);
  });

  test('reports what the run did', () => {
    assert.match(from(handler, 'return NextResponse.json({ ok: true'), /\.\.\.summary/);
  });
});

describe('seam 2: the store asks the question the logic assumes', () => {
  const src = code(STORE);
  const scan = from(src, 'async findDueCancellations(');

  test('only cancelled rows with a recorded cancellation time', () => {
    assert.match(scan, /eq\(reservations\.status,\s*'cancelled'\)/);
    assert.match(scan, /isNotNull\(reservations\.cancelledAt\)/);
  });

  test('never re-sends a follow-up that was already sent', () => {
    assert.match(scan, /eq\(reservations\.cancellationFollowupSent,\s*false\)/);
  });

  test('applies both ends of the window, exclusively', () => {
    assert.match(scan, /lt\(reservations\.cancelledAt,\s*cancelledBefore\)/);
    assert.match(scan, /gt\(reservations\.cancelledAt,\s*cancelledAfter\)/);
  });

  test('does not message opted-out contacts or tenants with AI off', () => {
    assert.match(scan, /eq\(tenants\.aiEnabled,\s*true\)/);
    assert.match(scan, /eq\(tenants\.manualMode,\s*false\)/);
    assert.match(scan, /or\(isNull\(contacts\.id\),\s*eq\(contacts\.blocklisted,\s*false\)\)/);
  });

  test('bounds the batch and drains it oldest-first', () => {
    assert.match(scan, /\.orderBy\(reservations\.cancelledAt\)/);
    assert.match(scan, /\.limit\(limit\)/);
  });

  test('sends through the outbox, not a direct operator call', () => {
    // The outbox owns retries and delivery state; a follow-up that dies on a
    // transient operator error must be retried, not lost.
    assert.doesNotMatch(src, /operatorClient/);
    const queue = from(src, 'async queueFollowup(');
    assert.match(queue, /insert\(jobs\)/);
    assert.match(queue, /type:\s*'send_whatsapp'/);
    assert.match(queue, /payload:\s*\{\s*waAccountId,\s*to,\s*text\s*\}/);
  });

  test('marking sent records both columns', () => {
    const mark = from(src, 'async markFollowupSent(');
    assert.match(mark, /cancellationFollowupSent:\s*true/);
    assert.match(mark, /cancellationFollowupSentAt:\s*sentAt/);
  });

  test('cancelling stamps the time the window is measured from', () => {
    const cancel = from(src, 'async cancelReservation(');
    assert.match(cancel, /status:\s*'cancelled'/);
    assert.match(cancel, /cancelledAt\b/);
  });
});

describe('seam 3: schema and migrations agree', () => {
  const schema = code(SCHEMA);
  const migration = readFileSync(MIGRATION, 'utf8');
  const migrateRoute = code(MIGRATE_DDL_FILE);

  const columns = ['cancelled_at', 'cancellation_followup_sent', 'cancellation_followup_sent_at'];

  test('the Drizzle schema declares all three columns', () => {
    for (const column of columns) {
      assert.match(schema, new RegExp(`'${column}'`), `schema is missing ${column}`);
    }
  });

  test('the sent flag defaults to false and is not nullable', () => {
    assert.match(
      schema,
      /cancellationFollowupSent:\s*boolean\('cancellation_followup_sent'\)\.default\(false\)\.notNull\(\)/
    );
  });

  test('cancelled_at stays nullable so existing rows are never followed up', () => {
    assert.match(schema, /cancelledAt:\s*timestamp\('cancelled_at'\),/);
    assert.doesNotMatch(schema, /cancelledAt:\s*timestamp\('cancelled_at'\)\.[^\n]*default/);
  });

  test('the migration adds every column idempotently', () => {
    for (const column of columns) {
      assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS "${column}"`), `migration is missing ${column}`);
    }
  });

  test('the migration indexes only the rows the cron can match', () => {
    assert.match(migration, /CREATE INDEX IF NOT EXISTS "reservations_cancellation_followup_idx"/);
    assert.match(migration, /WHERE "status" = 'cancelled' AND "cancellation_followup_sent" = false/);
  });

  test('/api/migrate carries the same DDL for the live database', () => {
    for (const column of columns) {
      assert.match(migrateRoute, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`), `migrate route is missing ${column}`);
    }
    assert.match(migrateRoute, /CREATE INDEX IF NOT EXISTS reservations_cancellation_followup_idx/);
  });
});
