import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { BASE_DDL, BASE_TABLES } from './base-ddl.ts';
import { MIGRATE_DDL, MIGRATE_TABLES } from './migrate-ddl.ts';

/**
 * RC3 / S1 — EXECUTES the shipped migration DDL against an in-memory
 * Postgres (pg-mem) and asserts the resulting database matches
 * lib/db/schema.ts.
 *
 * This is the check that actually matters for S1. The parity test proves the
 * statements name the right tables; this one proves they RUN, in order,
 * against a database that starts completely empty — which is the exact
 * condition that used to make /api/migrate abort on its first statement.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, '..', '..');

function schemaTables(): Set<string> {
  const src = readFileSync(join(MAIN, 'lib/db/schema.ts'), 'utf8');
  const out = new Set<string>();
  const re = /pgTable\(\s*['"]([a-z0-9_]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

/** Fresh empty database with the extensions/functions the DDL relies on. */
function freshDb() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  // gen_random_uuid() lives in pgcrypto; pg-mem needs it registered by hand.
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  return db;
}

function tableNames(db: any): Set<string> {
  const rows: { table_name: string }[] = db.public.many(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  return new Set(rows.map((r) => r.table_name.toLowerCase()));
}

/**
 * pg-mem does not implement plpgsql, so `DO $$ ... $$` blocks cannot be
 * executed. Those blocks only add FOREIGN KEY constraints (wrapped so a
 * re-run swallows duplicate_object) — they never create a table or column —
 * so skipping them does not weaken the table-parity assertion below.
 *
 * The shape is asserted rather than assumed: if a DO block ever starts doing
 * something structural, this throws and the test must be updated.
 */
function isPlpgsqlBlock(sql: string): boolean {
  return /^\s*DO \$\$/i.test(sql);
}

function assertOnlyForeignKeys(sql: string) {
  assert.match(
    sql,
    /ADD CONSTRAINT[\s\S]*FOREIGN KEY/i,
    'a DO block does more than add a FK constraint — update the pg-mem skip rule',
  );
}

/**
 * Runs the DDL, emulating the two pieces of Postgres semantics pg-mem lacks:
 *
 *  1. `CREATE TABLE IF NOT EXISTS x` on an existing table is a no-op with a
 *     NOTICE. pg-mem parses the guard but does not implement it, so we check
 *     existence ourselves and skip — which is exactly what Postgres does.
 *     This matters because the migration legitimately re-declares three
 *     tables (staff_members, wa_auth_keys from the base schema; competitors
 *     from both drizzle 0011 and 0012).
 *  2. `DO $$ ... $$` plpgsql blocks are unsupported; they only add FK
 *     constraints (see isPlpgsqlBlock).
 *
 * Anything that still throws after that is a genuine DDL problem.
 */
function runAll(db: any, statements: readonly string[]) {
  const failures: { index: number; sql: string; message: string }[] = [];
  const skipped: string[] = [];
  const skippedExisting: string[] = [];

  statements.forEach((sql, index) => {
    if (isPlpgsqlBlock(sql)) {
      assertOnlyForeignKeys(sql);
      skipped.push(sql.slice(0, 60));
      return;
    }

    const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS\s+"?([a-z0-9_]+)"?/i);
    if (createMatch && tableNames(db).has(createMatch[1].toLowerCase())) {
      skippedExisting.push(createMatch[1]);
      return;
    }

    try {
      db.public.none(sql);
    } catch (err) {
      failures.push({ index, sql: sql.slice(0, 140), message: (err as Error).message.slice(0, 220) });
    }
  });

  return { failures, skipped, skippedExisting };
}

describe('RC3 — /api/migrate DDL executes against an EMPTY database', () => {
  test('BASE_DDL runs clean and creates every base table', () => {
    const db = freshDb();
    const { failures } = runAll(db, BASE_DDL);
    assert.deepEqual(failures, [], 'BASE_DDL statements failed to execute');

    const created = tableNames(db);
    const missing = [...BASE_TABLES].filter((t) => !created.has(t));
    assert.deepEqual(missing, [], `base tables not created: ${missing.join(', ')}`);
  });

  test('BASE_DDL is re-runnable (idempotent)', () => {
    const db = freshDb();
    const first = runAll(db, BASE_DDL);
    assert.deepEqual(first.failures, [], 'first run failed');

    const second = runAll(db, BASE_DDL);
    assert.deepEqual(second.failures, [], 'second run failed — BASE_DDL is not idempotent');
    assert.ok(
      second.skippedExisting.length > 0,
      'expected the second run to skip existing tables (proves IF NOT EXISTS was exercised)',
    );
  });

  test('base + incremental creates EVERY table in schema.ts', () => {
    const db = freshDb();
    assert.deepEqual(runAll(db, BASE_DDL).failures, [], 'BASE_DDL failed');

    const { failures } = runAll(db, MIGRATE_DDL);
    assert.deepEqual(failures, [], 'MIGRATE_DDL statements failed to execute');

    const created = tableNames(db);
    const missing = Array.from(schemaTables()).filter((t) => !created.has(t)).sort();
    assert.deepEqual(
      missing,
      [],
      `schema.ts tables still missing after the full migration: ${missing.join(', ')}`,
    );
  });

  test('the full migration is re-runnable end to end', () => {
    const db = freshDb();
    const all = [...BASE_DDL, ...MIGRATE_DDL];
    assert.deepEqual(runAll(db, all).failures, [], 'first pass failed');

    const second = runAll(db, all);
    assert.deepEqual(second.failures, [], 'second pass failed — the migration is not idempotent');
    assert.ok(
      second.skippedExisting.length >= 3,
      'expected at least the 3 re-declared tables to be skipped on a re-run',
    );
  });

  test('the migration re-declares 3 tables, all guarded by IF NOT EXISTS', () => {
    // Documents the overlap between the base schema and the incremental DDL
    // (staff_members, wa_auth_keys) plus the competitors table declared by
    // both drizzle 0011 and 0012. Harmless in Postgres thanks to the guard,
    // but worth pinning so nobody removes it.
    const db = freshDb();
    const all = [...BASE_DDL, ...MIGRATE_DDL];
    runAll(db, all);
    const { skippedExisting } = runAll(db, all);
    for (const t of ['staff_members', 'wa_auth_keys', 'competitors']) {
      assert.ok(skippedExisting.includes(t), `${t} was not re-declared`);
    }
  });

  test('MIGRATE_TABLES all exist after the migration', () => {
    const db = freshDb();
    runAll(db, BASE_DDL);
    runAll(db, MIGRATE_DDL);
    const created = tableNames(db);
    const missing = [...MIGRATE_TABLES].filter((t) => !created.has(t)).sort();
    assert.deepEqual(missing, [], `incremental tables not created: ${missing.join(', ')}`);
  });

  test('order matters: incremental-only against an empty db is NOT sufficient', () => {
    // Regression guard for the original bug. Skipping BASE_DDL must leave
    // the base tables absent — proving BASE_DDL is load-bearing, not
    // decorative.
    const db = freshDb();
    runAll(db, MIGRATE_DDL);
    const created = tableNames(db);
    const missingBase = [...BASE_TABLES].filter((t) => !created.has(t));
    assert.ok(
      missingBase.length > 0,
      'expected base tables to be absent without BASE_DDL — is the test still meaningful?',
    );
    assert.ok(!created.has('tenants'), 'tenants should not exist without BASE_DDL');
  });

  test('the pg-mem skip rule only ever skips FK-constraint blocks', () => {
    const db = freshDb();
    const all = [...BASE_DDL, ...MIGRATE_DDL];
    const { skipped } = runAll(db, all);
    assert.ok(skipped.length > 0, 'expected some plpgsql blocks to be skipped');
    for (const s of skipped) assert.match(s, /DO \$\$/i);
  });
});
