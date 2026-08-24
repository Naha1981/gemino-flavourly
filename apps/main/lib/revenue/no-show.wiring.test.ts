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
 * the same style as the Gate #3 wiring tests: executing the handlers
 * would need Clerk and a live database, and mocking that stack would test
 * the mocks.
 *
 * They are mutation checks as much as wiring checks: dropping a predicate,
 * widening a comparison, flagging status directly, or routing one tenant's
 * message through another's account must fail a test here even if the
 * unit suite still passes.
 */

const CRON_ROUTE = join(APP, 'api', 'cron', 'no-show-detect', 'route.ts');
const LOGIC = join(HERE, 'no-show.ts');
const STORE = join(HERE, 'no-show-store.ts');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0004_no_show_monitoring.sql');
const JOURNAL = join(HERE, '..', '..', 'drizzle', 'meta', '_journal.json');
const MIGRATE_ROUTE = join(APP, 'api', 'migrate', 'route.ts');

/** Strip comments so prose describing behaviour is not mistaken for code. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** Everything from `needle` to end of file (use for the last match of a kind). */
function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

/** Just the body between two markers, so assertions cannot bleed across functions. */
function section(src: string, startNeedle: string, endNeedle: string): string {
  const body = from(src, startNeedle);
  const end = body.indexOf(endNeedle);
  assert.ok(end > -1, `"${endNeedle}" not found after "${startNeedle}"`);
  return body.slice(0, end);
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

describe('seam 2: the cron logic really is two phases with per-row re-validation', () => {
  const src = code(LOGIC);
  const run = from(src, 'export async function runNoShowCron(');

  test('detection runs before follow-up in the same invocation', () => {
    assert.ok(run.indexOf('findNoShowCandidates(') > -1, 'detection scan not found');
    assert.ok(run.indexOf('findNoShowCandidates(') < run.indexOf('findDueFollowups('), 'phases are out of order');
  });

  test('the store is handed the computed cutoff and delay window, not raw "now"', () => {
    assert.match(run, /findNoShowCandidates\(\{\s*cutoff,\s*limit\s*\}\)/);
    assert.match(run, /findDueFollowups\(\{\s*detectedBefore,\s*limit\s*\}\)/);
  });

  test('every returned row is re-validated before it is stamped or messaged', () => {
    assert.match(run, /detectionEligibility\(candidate,/);
    assert.match(run, /followupReadiness\(candidate,/);
    // Defense in depth, not decoration: nothing is stamped before the check.
    assert.ok(
      run.indexOf('detectionEligibility(candidate,') < run.indexOf('markNoShowDetected(candidate.id'),
      'detection stamps before re-validating'
    );
    assert.ok(
      run.indexOf('followupReadiness(candidate,') < run.indexOf('queueFollowup({'),
      'follow-up queues before re-validating'
    );
  });

  test('the cutoff is the max() refinement, and the delay window is strict', () => {
    assert.match(src, /dayStart\.getTime\(\)\s*>\s*graceCutoff\.getTime\(\)\s*\?\s*dayStart\s*:\s*graceCutoff/);
    assert.match(src, /candidate\.noShowDetectedAt\.getTime\(\)\s*>=\s*dueBefore\.getTime\(\)/);
    assert.match(src, /candidate\.reservationDate\.getTime\(\)\s*>=\s*computeDetectionCutoff\(/);
  });

  test('dedup flags are stamped only after the work succeeds', () => {
    // The follow-up is queued first and marked sent second — an outbox
    // retry must never be able to produce a second "we missed you".
    assert.match(run, /markNoShowDetected\(candidate\.id,\s*now\)/);
    assert.match(run, /markFollowupSent\(candidate\.id,\s*now\)/);
    assert.ok(run.indexOf('queueFollowup({') < run.indexOf('markFollowupSent(candidate.id'), 'marks sent before queueing');
  });

  test('the message is the Gate #4 copy with the upcoming Saturday', () => {
    const build = from(src, 'export function buildNoShowFollowupMessage(');
    assert.match(build, /we missed you tonight! We still have tables available this \$\{weekday\}\. Would you like to rebook\?/);
    assert.match(build, /DAY_NAMES\[nextWeekendDate\(input\.now\)\.getUTCDay\(\)\]/);
    assert.match(src, /candidate\.getUTCDay\(\)\s*===\s*WEEKEND_OFFER_DAY/);
  });
});

describe('seam 3: the store asks the questions the logic assumes', () => {
  const src = code(STORE);
  const scan = section(src, 'async findNoShowCandidates(', 'async markNoShowDetected(');

  test('detection scans only unflagged confirmed bookings past the cutoff', () => {
    assert.match(scan, /eq\(reservations\.status,\s*'confirmed'\)/);
    assert.match(scan, /eq\(reservations\.noShowDetected,\s*false\)/);
    // Mutation check: widening this bound (gt/gte) would re-process the
    // whole day's future bookings every 30 minutes.
    assert.match(scan, /lt\(reservations\.date,\s*cutoff\)/);
  });

  test('detection excludes opted-out contacts, AI-off/manual tenants, takeover threads', () => {
    assert.match(scan, /eq\(tenants\.aiEnabled,\s*true\)/);
    assert.match(scan, /eq\(tenants\.manualMode,\s*false\)/);
    assert.match(scan, /or\(isNull\(contacts\.id\),\s*eq\(contacts\.blocklisted,\s*false\)\)/);
    assert.match(scan, /or\(isNull\(conversations\.id\),\s*eq\(conversations\.manualTakeover,\s*false\)\)/);
  });

  test('detection bounds the batch and drains it oldest-first', () => {
    assert.match(scan, /\.orderBy\(reservations\.date\)/);
    assert.match(scan, /\.limit\(limit\)/);
  });

  test('flagging stamps only the cron’s own columns, never status', () => {
    const mark = section(src, 'async markNoShowDetected(', 'async findDueFollowups(');
    assert.match(mark, /noShowDetected:\s*true/);
    assert.match(mark, /noShowDetectedAt:\s*detectedAt/);
    // Mutation check: flipping status here would bypass the staff decision
    // and poison Gate #3's status-based scans.
    assert.doesNotMatch(mark, /status\s*:/);
    assert.match(mark, /eq\(reservations\.id,\s*reservationId\)/);
  });

  test('the follow-up scan re-checks detection, the delay window, and confirmed status', () => {
    const followups = section(src, 'async findDueFollowups(', 'async findRecipient(');
    assert.match(followups, /eq\(reservations\.status,\s*'confirmed'\)/);
    assert.match(followups, /eq\(reservations\.noShowDetected,\s*true\)/);
    assert.match(followups, /isNotNull\(reservations\.noShowDetectedAt\)/);
    assert.match(followups, /eq\(reservations\.noShowFollowupSent,\s*false\)/);
    assert.match(followups, /lt\(reservations\.noShowDetectedAt,\s*detectedBefore\)/);
    assert.match(followups, /\.orderBy\(reservations\.noShowDetectedAt\)/);
    assert.match(followups, /\.limit\(limit\)/);
    // A contact opting out or a thread entering takeover between detection
    // and the message must still suppress the send.
    assert.match(followups, /or\(isNull\(contacts\.id\),\s*eq\(contacts\.blocklisted,\s*false\)\)/);
    assert.match(followups, /or\(isNull\(conversations\.id\),\s*eq\(conversations\.manualTakeover,\s*false\)\)/);
  });

  test('recipient resolution bows out of manual takeover and scopes to the reservation’s tenant', () => {
    const recipient = section(src, 'async findRecipient(', 'async queueFollowup(');
    assert.match(recipient, /if\s*\(conversation\?\.manualTakeover\)\s*return\s+null\s*;/);
    // Mutation check: dropping reservation.tenantId here routes one
    // restaurant's follow-up through whichever account Postgres returns
    // first — a cross-tenant leak.
    assert.match(recipient, /eq\(waAccounts\.tenantId,\s*reservation\.tenantId\)/);
    assert.match(recipient, /eq\(waAccounts\.isConnected,\s*true\)/);
    assert.match(recipient, /eq\(contacts\.blocklisted,\s*false\)/);
  });

  test('sends through the outbox, not a direct operator call', () => {
    // The outbox owns retries and delivery state; a follow-up that dies on
    // a transient operator error must be retried, not lost.
    assert.doesNotMatch(src, /operatorClient/);
    const queue = section(src, 'async queueFollowup(', 'async markFollowupSent(');
    assert.match(queue, /insert\(jobs\)/);
    assert.match(queue, /type:\s*'send_whatsapp'/);
    assert.match(queue, /payload:\s*\{\s*waAccountId,\s*to,\s*text\s*\}/);
  });

  test('marking the follow-up sent records both columns', () => {
    const mark = from(src, 'async markFollowupSent(');
    assert.match(mark, /noShowFollowupSent:\s*true/);
    assert.match(mark, /noShowFollowupSentAt:\s*sentAt/);
  });
});

describe('seam 4: schema, migration, journal and /api/migrate agree', () => {
  const schema = code(SCHEMA);
  const migration = readFileSync(MIGRATION, 'utf8');
  const journal = readFileSync(JOURNAL, 'utf8');
  const migrateRoute = code(MIGRATE_ROUTE);

  const columns = ['no_show_detected', 'no_show_detected_at', 'no_show_followup_sent', 'no_show_followup_sent_at'];

  test('the Drizzle schema declares all four columns', () => {
    for (const column of columns) {
      assert.match(schema, new RegExp(`'${column}'`), `schema is missing ${column}`);
    }
  });

  test('the dedup flags default to false and are not nullable', () => {
    assert.match(schema, /noShowDetected:\s*boolean\('no_show_detected'\)\.default\(false\)\.notNull\(\)/);
    assert.match(schema, /noShowFollowupSent:\s*boolean\('no_show_followup_sent'\)\.default\(false\)\.notNull\(\)/);
  });

  test('the timestamps stay nullable with no default so the migration is additive', () => {
    assert.match(schema, /noShowDetectedAt:\s*timestamp\('no_show_detected_at'\),/);
    assert.doesNotMatch(schema, /noShowDetectedAt:\s*timestamp\('no_show_detected_at'\)\.[^\n]*default/);
    assert.match(schema, /noShowFollowupSentAt:\s*timestamp\('no_show_followup_sent_at'\),/);
    assert.doesNotMatch(schema, /noShowFollowupSentAt:\s*timestamp\('no_show_followup_sent_at'\)\.[^\n]*default/);
  });

  test('the schema declares both partial indexes', () => {
    assert.match(schema, /noShowDetectionIdx:\s*index\('reservations_no_show_detection_idx'\)/);
    assert.match(schema, /noShowFollowupIdx:\s*index\('reservations_no_show_followup_idx'\)/);
  });

  test('the migration adds every column idempotently', () => {
    for (const column of columns) {
      assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS "${column}"`), `migration is missing ${column}`);
    }
  });

  test('the migration indexes only the rows each phase can match', () => {
    assert.match(migration, /CREATE INDEX IF NOT EXISTS "reservations_no_show_detection_idx"/);
    assert.match(migration, /WHERE "status" = 'confirmed' AND "no_show_detected" = false/);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS "reservations_no_show_followup_idx"/);
    assert.match(migration, /WHERE "no_show_followup_sent" = false AND "no_show_detected_at" IS NOT NULL/);
  });

  test('the migration is registered in the drizzle journal, or migrate would skip it', () => {
    assert.match(journal, /"0004_no_show_monitoring"/);
  });

  test('/api/migrate carries the same DDL for the live database', () => {
    for (const column of columns) {
      assert.match(migrateRoute, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`), `migrate route is missing ${column}`);
    }
    assert.match(migrateRoute, /CREATE INDEX IF NOT EXISTS reservations_no_show_detection_idx/);
    assert.match(migrateRoute, /CREATE INDEX IF NOT EXISTS reservations_no_show_followup_idx/);
    assert.match(migrateRoute, /WHERE status = 'confirmed' AND no_show_detected = false;/);
    assert.match(migrateRoute, /WHERE no_show_followup_sent = false AND no_show_detected_at IS NOT NULL;/);
  });
});
