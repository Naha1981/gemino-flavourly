#!/usr/bin/env node
/**
 * Standalone smoke test: run the generated gate DDL through pg-mem and
 * report every statement that fails. Used during GATE V4/V5 harness build
 * to pin down pg-mem compatibility issues before wiring into Next.js.
 *
 * Usage: node scripts/gate-pgmem-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// pg-mem is nested under apps/main/node_modules (workspace install).
const require = createRequire(join(root, 'apps', 'main', 'noop.js'));
const { newDb } = require('pg-mem');

const ddl = readFileSync(join(root, 'apps', 'main', 'lib', 'gate-mock', 'ddl.sql'), 'utf8');
const DELIM = '-- @@GATE-STATEMENT@@';
// Every statement sits between delimiters; strip leading comment lines
// (headers / per-statement notes) before executing.
const statements = ddl
  .split(new RegExp(`${DELIM}\\s*`))
  .map((s) => s.replace(/^(?:--[^\n]*\n)+/, '').trim())
  .filter(Boolean);

const mem = newDb();
// pg-mem does not implement Postgres' gen_random_uuid(); the DDL defaults
// use it. Register a faithful stand-in.
mem.public.registerFunction({
  name: 'gen_random_uuid',
  returns: 'uuid',
  implementation: () => randomUUID(),
});

// Same skip as lib/gate-mock/pgmem-db.ts: pg-mem crashes in its planner
// when a `CREATE TABLE IF NOT EXISTS` targets a table that ALREADY exists
// (it re-parses the column constraints on the "not exists" path and throws
// "Not supported" for inline PRIMARY KEY / NOT NULL). Skipping is exactly
// the `IF NOT EXISTS` semantics, so behaviour is faithful.
const relMap = mem.public.relsByNameCas;
let ok = 0;
let skippedExisting = 0;
const failures = [];
for (const stmt of statements) {
  const ctine = stmt.match(/^CREATE TABLE IF NOT EXISTS\s+["']?(\w+)["']?/i);
  if (ctine && relMap.has(ctine[1].toLowerCase())) {
    ok += 1;
    skippedExisting += 1;
    continue;
  }
  try {
    await mem.public.none(stmt);
    ok += 1;
  } catch (err) {
    failures.push({ head: stmt.slice(0, 90).replace(/\s+/g, ' '), error: String(err.message ?? err).slice(0, 200) });
  }
}
console.log(
  `pg-mem DDL smoke: ${ok}/${statements.length} statements OK` +
    (skippedExisting ? ` (${skippedExisting} IF NOT EXISTS already present)` : ''),
);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f.head}\n      ${f.error}`);
  process.exitCode = 1;
}
