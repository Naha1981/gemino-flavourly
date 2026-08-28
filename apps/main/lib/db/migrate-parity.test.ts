import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_DDL, BASE_TABLES } from './base-ddl.ts';
import { MIGRATE_DDL, MIGRATE_TABLES } from './migrate-ddl.ts';

/**
 * RC3 / S1 — migration parity.
 *
 * Before the fix, /api/migrate created 23 of the 37 tables in schema.ts and
 * then immediately ran `ALTER TABLE tenants ADD COLUMN ...`. `tenants` is one
 * of the 16 base tables it never created, so against any database missing
 * the base schema the route threw on its first statement
 * ("relation \"tenants\" does not exist") and NOTHING got migrated — leaving
 * every dashboard query failing with the same error.
 *
 * These tests pin the invariant: /api/migrate alone must be able to
 * bootstrap an empty database to full schema parity. Execution against a
 * real (in-memory) Postgres lives in ./migrate-execute.test.ts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, '..', '..');

function read(rel: string): string {
  const p = join(MAIN, rel);
  assert.ok(existsSync(p), `missing file: ${rel}`);
  return readFileSync(p, 'utf8');
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Every table declared in the Drizzle schema (the source of truth). */
function schemaTables(): Set<string> {
  const src = read('lib/db/schema.ts');
  const out = new Set<string>();
  const re = /pgTable\(\s*['"]([a-z0-9_]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

/** Tables created by a blob of raw SQL (used only for .sql files). */
function tablesInSql(sql: string): Set<string> {
  const out = new Set<string>();
  const re = /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?([a-z0-9_]+)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.add(m[1].toLowerCase());
  return out;
}

const sorted = (s: Set<string> | readonly string[]) => Array.from(s).sort();
const MIGRATE_ROUTE = 'app/api/migrate/route.ts';

describe('RC3 — base DDL mirrors drizzle/0000 exactly', () => {
  const drizzle0000 = read('drizzle/0000_flimsy_mordo.sql');
  const drizzleTables = tablesInSql(drizzle0000);
  const ddlTables = new Set<string>(BASE_TABLES);

  test('same table set as the source migration', () => {
    assert.deepEqual(sorted(ddlTables), sorted(drizzleTables));
  });

  test('BASE_TABLES agrees with the statements actually embedded', () => {
    const embedded = tablesInSql(BASE_DDL.join('\n'));
    assert.deepEqual(sorted(embedded), sorted(drizzleTables));
  });

  test('every embedded statement is idempotent', () => {
    for (const stmt of BASE_DDL) {
      const head = stmt.trimStart().slice(0, 40).toUpperCase();
      if (head.startsWith('CREATE ')) {
        assert.match(stmt, /IF NOT EXISTS/i, `not idempotent: ${stmt.slice(0, 70)}`);
      } else {
        assert.match(
          stmt,
          /duplicate_object/i,
          `non-CREATE statement must tolerate re-runs: ${stmt.slice(0, 70)}`,
        );
      }
    }
  });
});

describe('RC3 — /api/migrate can bootstrap an EMPTY database', () => {
  const route = stripComments(read(MIGRATE_ROUTE));
  // Table lists come from the generated modules' exported constants rather
  // than by regexing the source: the modules preserve the route's original
  // explanatory comments, and prose such as "the CREATE TABLE above" would
  // otherwise be parsed as a table name.
  const baseTables = new Set<string>(BASE_TABLES);
  const incrementalTables = new Set<string>(MIGRATE_TABLES);
  const union = new Set<string>([...BASE_TABLES, ...MIGRATE_TABLES]);
  const schema = schemaTables();

  test('the route applies BOTH DDL modules', () => {
    assert.match(route, /from '@\/lib\/db\/base-ddl'/);
    assert.match(route, /from '@\/lib\/db\/migrate-ddl'/);
    assert.match(route, /BASE_DDL/);
    assert.match(route, /MIGRATE_DDL/);
  });

  test('base DDL is applied BEFORE the incremental DDL', () => {
    // Ordering is the whole point: every incremental statement starts with
    // ALTER TABLE <base table>, which throws if that table does not exist
    // yet — the exact failure that was observed.
    const baseAt = route.indexOf('...BASE_DDL.map');
    const incrementalAt = route.indexOf('...MIGRATE_DDL.map');
    assert.ok(baseAt > -1, 'BASE_DDL is never applied');
    assert.ok(incrementalAt > -1, 'MIGRATE_DDL is never applied');
    assert.ok(
      baseAt < incrementalAt,
      `BASE_DDL must be applied before MIGRATE_DDL (base@${baseAt}, incremental@${incrementalAt})`,
    );
  });

  test('base + incremental DDL covers EVERY table in schema.ts', () => {
    const missing = Array.from(schema).filter((t) => !union.has(t)).sort();
    assert.deepEqual(
      missing,
      [],
      `tables in schema.ts that /api/migrate cannot create: ${missing.join(', ')}`,
    );
  });

  test('no table is created by the DDL but missing from schema.ts', () => {
    // Guards against the DDL drifting away from the Drizzle schema in the
    // other direction (a typo'd table name would silently create junk).
    const orphans = Array.from(incrementalTables).filter((t) => !schema.has(t)).sort();
    assert.deepEqual(orphans, [], `tables not in schema.ts: ${orphans.join(', ')}`);
  });

  test('every base table exists in schema.ts (no reliance on drizzle-kit)', () => {
    const missingBase = Array.from(baseTables).filter((t) => !schema.has(t)).sort();
    assert.deepEqual(missingBase, [], `base tables not in schema.ts: ${missingBase.join(', ')}`);
  });

  test('the route no longer contains inline DDL (single source of truth)', () => {
    // The statements were lifted into lib/db/migrate-ddl.ts so the parity
    // test can execute the SHIPPED DDL. Inline copies would drift.
    assert.ok(!/await sql`/.test(route), 'route still has inline `await sql` blocks');
  });

  test('the route reports which statement failed', () => {
    assert.match(route, /failedStatement/);
    assert.match(route, /appliedStatements/);
  });

  test('the DDL modules are executable arrays, not opaque blobs', () => {
    assert.ok(Array.isArray(BASE_DDL) && BASE_DDL.length > 0, 'BASE_DDL must be a non-empty array');
    assert.ok(
      Array.isArray(MIGRATE_DDL) && MIGRATE_DDL.length > 0,
      'MIGRATE_DDL must be a non-empty array',
    );
    for (const s of [...BASE_DDL, ...MIGRATE_DDL]) {
      assert.equal(typeof s, 'string');
      assert.ok(s.trim().length > 0, 'empty DDL statement');
    }
  });
});

describe('RC3 — parity holds across every Drizzle migration file', () => {
  test('schema.ts tables are all created somewhere in drizzle/ or the DDL modules', () => {
    const dir = join(MAIN, 'drizzle');
    const all = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.sql')) {
        tablesInSql(readFileSync(join(dir, f), 'utf8')).forEach((t) => all.add(t));
      }
    }
    for (const t of [...BASE_TABLES, ...MIGRATE_TABLES]) all.add(t);

    const missing = Array.from(schemaTables()).filter((t) => !all.has(t)).sort();
    assert.deepEqual(missing, [], `no DDL anywhere creates: ${missing.join(', ')}`);
  });
});
