import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');

/**
 * Gate #4 wiring tests.
 *
 * no-show.test.ts runs the real decision logic and the real cron
 * orchestration against an in-memory reservations table. What it cannot
 * see is whether the cron route actually calls it, whether the Postgres
 * adapter asks the question the logic assumes, or whether the schema and
 * migrations agree with each other. These assertions pin those seams, in
 * the same style as the Gate #2/3 wiring tests: executing the handlers
 * would need Clerk and a live database, and mocking that stack would test
 * the mocks.
 */

const CRON_ROUTE = join(APP, 'api', 'cron', 'no-show-detect', 'route.ts');
const STORE = join(HERE, 'no-show-store.ts');
const LOGIC = join(HERE, 'no-show.ts');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0004_no_show_monitoring.sql');
const MIGRATE_ROUTE = join(APP, 'api', 'migrate', 'route.ts');

/** Strip comments so prose describing behaviour is not mistaken for code. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** Slice from `needle` to the end of the source — or to `until`, for method-scoped checks. */
function from(src: string, needle: string, until?: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  if (until === undefined) return src.slice(at);
  const end = src.indexOf(until, at);
  assert.ok(end > at, `"${until}" not found after "${needle}"`);
  return src.slice(at, end);
}

describe('seam 1: the cron route runs the no-show logic behind the shared guard', () => {
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
    assert.match(handler, /runNoShowCron\(\s*drizzleNoShowStore\s*,/);
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
  // Method-scoped slices, so a negative assertion about phase 1 cannot be
  // "satisfied" by phase 2's code later in the same file.
  const detect = from(src, 'async findDetectable(', 'async findFollowupDue(');
  const due = from(src, 'async findFollowupDue(', 'async findRecipient(');

  test('phase 1: only confirmed rows, not yet detected, past the cutoff', () => {
    assert.match(detect, /eq\(reservations\.status,\s*'confirmed'\)/);
    assert.match(detect, /eq\(reservations\.noShowDetected,\s*false\)/);
    assert.match(detect, /lt\(reservations\.date,\s*cutoff\)/);
  });

  test('phase 1 is intentionally NOT filtered by the messaging safety flags', () => {
    // Detection is a factual record that costs the customer nothing; the
    // safety filters belong to the follow-up scan.
    assert.doesNotMatch(detect, /aiEnabled/);
    assert.doesNotMatch(detect, /blocklisted/);
    assert.doesNotMatch(detect, /manualMode/);
  });

  test('phase 1 drains the backlog oldest-first and bounds the batch', () => {
    assert.match(detect, /\.orderBy\(reservations\.date\)/);
    assert.match(detect, /\.limit\(limit\)/);
  });

  test('phase 2: only detected rows whose offer has not gone out', () => {
    assert.match(due, /eq\(reservations\.noShowFollowupSent,\s*false\)/);
    assert.match(due, /isNotNull\(reservations\.noShowDetectedAt\)/);
    assert.match(due, /lt\(reservations\.noShowDetectedAt,\s*detectedBefore\)/);
  });

  test('phase 2 never messages opted-out contacts or tenants with AI off / manual mode', () => {
    assert.match(due, /eq\(tenants\.aiEnabled,\s*true\)/);
    assert.match(due, /eq\(tenants\.manualMode,\s*false\)/);
    assert.match(due, /or\(isNull\(contacts\.id\),\s*eq\(contacts\.blocklisted,\s*false\)\)/);
  });

  test('phase 2 bows out of manual-takeover threads', () => {
    assert.match(due, /or\(isNull\(conversations\.id\),\s*eq\(conversations\.manualTakeover,\s*false\)\)/);
  });

  test('phase 2 drains the backlog oldest-first and bounds the batch', () => {
    assert.match(due, /\.orderBy\(reservations\.noShowDetectedAt\)/);
    assert.match(due, /\.limit\(limit\)/);
  });

  test('sends through the outbox, not a direct operator call', () => {
    // The outbox owns retries and delivery state; a follow-up that dies on
    // a transient operator error must be retried, not lost.
    assert.doesNotMatch(src, /operatorClient/);
    const queue = from(src, 'async queueFollowup(');
    assert.match(queue, /insert\(jobs\)/);
    assert.match(queue, /type:\s*'send_whatsapp'/);
    assert.match(queue, /payload:\s*\{\s*waAccountId,\s*to,\s*text\s*\}/);
  });

  test('recipient resolution is per-reservation tenant scoped', () => {
    // The account fallback must be looked up on the RESERVATION's own
    // tenant — never a neighbouring tenant's account.
    const recipient = from(src, 'async findRecipient(');
    assert.match(recipient, /eq\(waAccounts\.tenantId,\s*reservation\.tenantId\)/);
    // And an automated offer must not land in a thread staff is running.
    assert.match(recipient, /manualTakeover/);
    assert.match(recipient, /blocklisted/);
  });

  test('detection stamps both columns', () => {
    const mark = from(src, 'async markDetected(');
    assert.match(mark, /noShowDetected:\s*true/);
    assert.match(mark, /noShowDetectedAt:\s*detectedAt/);
  });

  test('marking sent records both columns (dedup lives on the row)', () => {
    const mark = from(src, 'async markFollowupSent(');
    assert.match(mark, /noShowFollowupSent:\s*true/);
    assert.match(mark, /noShowFollowupSentAt:\s*sentAt/);
  });
});

describe('seam 3: the handler re-validates its own predicates (defense in depth)', () => {
  const src = code(LOGIC);
  const run = from(src, 'export async function runNoShowCron(');

  test('phase 1 re-checks status, the detected flag, and the cutoff from the row', () => {
    assert.match(run, /reservation\.status\s*!==\s*'confirmed'/);
    assert.match(run, /reservation\.noShowDetected\b/);
    assert.match(run, /isNoShowDue\(/);
  });

  test('phase 2 bows out of manual-takeover rows before messaging', () => {
    assert.match(run, /reservation\.manualTakeover/);
  });

  test('phase 2 re-checks the 2h delay before messaging', () => {
    assert.match(run, /noShowFollowupEligibility\(/);
  });

  test('the rebook offer follows the gate copy', () => {
    const build = from(src, 'export function buildNoShowMessage(');
    assert.match(build, /we missed you tonight!/);
    assert.match(build, /Would you like to rebook\?/);
    assert.match(build, /there/);
  });
});

describe('seam 4: schema, migration, and /api/migrate agree', () => {
  const schema = code(SCHEMA);
  const migration = readFileSync(MIGRATION, 'utf8');
  const migrateRoute = code(MIGRATE_ROUTE);

  const columns = ['no_show_detected', 'no_show_detected_at', 'no_show_followup_sent', 'no_show_followup_sent_at'];

  test('the Drizzle schema declares all four columns', () => {
    for (const column of columns) {
      assert.match(schema, new RegExp(`'${column}'`), `schema is missing ${column}`);
    }
  });

  test('the flags default to false and are not nullable', () => {
    assert.match(schema, /noShowDetected:\s*boolean\('no_show_detected'\)\.default\(false\)\.notNull\(\)/);
    assert.match(schema, /noShowFollowupSent:\s*boolean\('no_show_followup_sent'\)\.default\(false\)\.notNull\(\)/);
  });

  test('the timestamps stay nullable so existing rows are never detected or messaged', () => {
    assert.match(schema, /noShowDetectedAt:\s*timestamp\('no_show_detected_at'\),/);
    assert.doesNotMatch(schema, /noShowDetectedAt:\s*timestamp\('no_show_detected_at'\)\.[^\n]*default/);
    assert.match(schema, /noShowFollowupSentAt:\s*timestamp\('no_show_followup_sent_at'\),/);
    assert.doesNotMatch(schema, /noShowFollowupSentAt:\s*timestamp\('no_show_followup_sent_at'\)\.[^\n]*default/);
  });

  test('the migration adds every column idempotently', () => {
    for (const column of columns) {
      assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS "${column}"`), `migration is missing ${column}`);
    }
  });

  test('the migration indexes only the rows each scan can match', () => {
    assert.match(migration, /CREATE INDEX IF NOT EXISTS "reservations_no_show_detection_idx"/);
    assert.match(migration, /WHERE "status" = 'confirmed' AND "no_show_detected" = false/);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS "reservations_no_show_followup_idx"/);
    assert.match(migration, /WHERE "no_show_followup_sent" = false AND "no_show_detected_at" IS NOT NULL/);
  });

  test('/api/migrate carries the same DDL for the live database', () => {
    for (const column of columns) {
      assert.match(migrateRoute, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`), `migrate route is missing ${column}`);
    }
    assert.match(migrateRoute, /CREATE INDEX IF NOT EXISTS reservations_no_show_detection_idx/);
    assert.match(migrateRoute, /WHERE status = 'confirmed' AND no_show_detected = false/);
    assert.match(migrateRoute, /CREATE INDEX IF NOT EXISTS reservations_no_show_followup_idx/);
    assert.match(migrateRoute, /WHERE no_show_followup_sent = false AND no_show_detected_at IS NOT NULL/);
  });
});
