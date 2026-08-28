#!/usr/bin/env node
/**
 * Extracts the incremental DDL out of app/api/migrate/route.ts into
 * apps/main/lib/db/migrate-ddl.ts as an ordered, executable array.
 *
 * Why: the DDL was 150 inline `await sql`...`` blocks inside the route
 * handler. That made it impossible to execute the real migration statements
 * in a test — the only way to run them was to call the authenticated route
 * against a live production database. Lifting them into a module keeps the
 * route thin (it just iterates the list) and lets the parity test execute
 * the SHIPPED statements against an in-memory Postgres.
 *
 * Statements are copied verbatim (none are interpolated), so this is a
 * faithful move, not a rewrite.
 *
 * STATUS: one-time extraction — already applied. lib/db/migrate-ddl.ts is now
 * the source of truth for the incremental DDL and app/api/migrate/route.ts
 * just iterates it. Re-running this script finds no `await sql` blocks in the
 * route and exits non-zero rather than overwriting the module with nothing.
 *
 * Usage: node scripts/gen-migrate-ddl.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE = join(ROOT, 'apps/main/app/api/migrate/route.ts');
const OUT = join(ROOT, 'apps/main/lib/db/migrate-ddl.ts');

const src = readFileSync(ROUTE, 'utf8');
const lines = src.split('\n');

/** @type {{comment: string[], sql: string}[]} */
const entries = [];
let pendingComments = [];

const START = /^\s*await sql`/;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();

  if (trimmed.startsWith('//')) {
    pendingComments.push(trimmed);
    continue;
  }
  if (trimmed === '' || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
    // Blank lines break a comment block's association with the next stmt.
    if (trimmed === '') pendingComments = [];
    continue;
  }

  if (START.test(line)) {
    // Collect until the closing `;`;`
    const buf = [line.replace(START, '')];
    let j = i;
    while (!/`;\s*$/.test(lines[j])) {
      j++;
      if (j >= lines.length) throw new Error(`unterminated sql block near line ${i + 1}`);
      buf.push(lines[j]);
    }
    let sql = buf.join('\n');
    sql = sql.replace(/`;\s*$/, '');
    // Drop the first newline + indentation for a tidy single-line-ish entry.
    sql = sql.replace(/^\n\s*/, '').replace(/\s+$/g, '');
    entries.push({ comment: pendingComments, sql });
    pendingComments = [];
    i = j;
    continue;
  }

  // Any other code line detaches the pending comment block.
  pendingComments = [];
}

if (entries.length === 0) {
  console.error('No `await sql` blocks found — refusing to write an empty migration.');
  process.exit(1);
}

// Idempotency audit: every statement must be safe to re-run, because this
// route is executed against production on every deploy.
const risky = entries.filter((e) => {
  const s = e.sql.trimStart();
  const head = s.slice(0, 40).toUpperCase();
  if (head.startsWith('CREATE ')) return !/IF NOT EXISTS/i.test(s);
  if (head.startsWith('DROP ')) return !/IF EXISTS/i.test(s);
  if (head.startsWith('ALTER TABLE')) {
    // ADD/DROP COLUMN need the IF [NOT] EXISTS guard...
    if (/ADD COLUMN(?! IF NOT EXISTS)/i.test(s)) return true;
    if (/DROP COLUMN(?! IF EXISTS)/i.test(s)) return true;
    // ...but ALTER COLUMN forms are naturally re-runnable: dropping an
    // already-absent NOT NULL, or re-setting a DEFAULT, is a no-op rather
    // than an error.
    if (/ALTER COLUMN/i.test(s)) {
      return !/DROP NOT NULL|SET DEFAULT|DROP DEFAULT|SET NOT NULL|TYPE /i.test(s);
    }
    return !/IF NOT EXISTS|IF EXISTS/i.test(s);
  }
  return true;
});
if (risky.length) {
  console.error(`Found ${risky.length} non-idempotent statement(s):`);
  for (const r of risky.slice(0, 12)) console.error('  ' + r.sql.slice(0, 90).replace(/\n/g, ' '));
  process.exit(1);
}

const tables = new Set();
for (const e of entries) {
  const re = /CREATE TABLE IF NOT EXISTS\s+"?([a-z0-9_]+)"?/gi;
  let m;
  while ((m = re.exec(e.sql))) tables.add(m[1]);
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const body = entries
  .map((e) => {
    const c = e.comment.length ? e.comment.map((l) => '  ' + l).join('\n') + '\n' : '';
    return c + '  `' + esc(e.sql) + '`,\n';
  })
  .join('\n');

const header = `/**
 * Incremental migration DDL for /api/migrate.
 *
 * GENERATED FILE — do not edit by hand.
 * Source of truth: apps/main/app/api/migrate/route.ts
 * Regenerate with:  node scripts/gen-migrate-ddl.mjs
 *
 * Lifted verbatim out of the route handler so the SHIPPED statements can be
 * executed by the parity test (lib/db/migrate-parity.test.ts) instead of
 * only being asserted on as source text. Applied in order, after BASE_DDL.
 *
 * Every statement is idempotent — this route runs against production on
 * every deploy.
 */

/** Tables this DDL creates (${tables.size} total). */
export const MIGRATE_TABLES = ${JSON.stringify([...tables].sort(), null, 2)} as const;

/** Ordered, idempotent DDL statements. Applied after BASE_DDL. */
export const MIGRATE_DDL: readonly string[] = [
`;

writeFileSync(OUT, header + '\n' + body + '];\n', 'utf8');
console.log(`Wrote ${OUT}`);
console.log(`  statements: ${entries.length}`);
console.log(`  tables:     ${tables.size}`);
