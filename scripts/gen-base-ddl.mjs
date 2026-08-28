#!/usr/bin/env node
/**
 * Generates apps/main/lib/db/base-ddl.ts from the Drizzle base migration.
 *
 * Why: /api/migrate is the only migration path available against production
 * (there is no shell in a serverless function, and drizzle-kit is a
 * devDependency that is not bundled into the Lambda). It used to start with
 * `ALTER TABLE tenants ...` and so assumed the 16 base tables already
 * existed — on any database missing them the route failed on its very first
 * statement and nothing at all got migrated.
 *
 * This embeds the base schema as plain idempotent SQL strings so the route
 * can bootstrap an empty database, with no filesystem dependency at runtime.
 *
 * Usage: node scripts/gen-base-ddl.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'apps/main/drizzle/0000_flimsy_mordo.sql');
const OUT = join(ROOT, 'apps/main/lib/db/base-ddl.ts');

const raw = readFileSync(SRC, 'utf8');

const statements = raw
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean);

// Fail loudly rather than silently emitting a non-idempotent migration: a
// statement without IF NOT EXISTS / duplicate_object handling would throw on
// the second run and abort the whole migration.
const problems = statements.filter((s) => {
  const head = s.slice(0, 60).toUpperCase();
  const isCreate = head.startsWith('CREATE ');
  if (!isCreate) return !/duplicate_object/i.test(s) && !head.startsWith('DO $$');
  return !/IF NOT EXISTS/i.test(s);
});
if (problems.length > 0) {
  console.error('Non-idempotent statements found — refusing to generate:');
  for (const p of problems) console.error('  ' + p.slice(0, 90).replace(/\n/g, ' '));
  process.exit(1);
}

const tables = statements
  .map((s) => s.match(/CREATE TABLE IF NOT EXISTS\s+"?([a-z0-9_]+)"?/i))
  .filter(Boolean)
  .map((m) => m[1]);

const banner = `/**
 * Base schema DDL, generated from drizzle/0000_flimsy_mordo.sql.
 *
 * GENERATED FILE — do not edit by hand.
 * Regenerate with:  node scripts/gen-base-ddl.mjs
 *
 * Every statement is idempotent (CREATE ... IF NOT EXISTS, or a DO block that
 * swallows duplicate_object), so running the whole list against a database
 * that already has some or all of it is a no-op rather than an error.
 *
 * Consumed by app/api/migrate/route.ts, which must be able to bootstrap a
 * completely empty database: drizzle-kit is a devDependency and is not
 * available inside the serverless function.
 */

/** Tables created by this DDL (${tables.length} total). */
export const BASE_TABLES = ${JSON.stringify(tables, null, 2)} as const;

/** Ordered, idempotent DDL statements. */
export const BASE_DDL: readonly string[] = [
`;

const body = statements
  .map((s) => '  `' + s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`,')
  .join('\n');

const footer = `
];
`;

writeFileSync(OUT, banner + body + footer, 'utf8');
console.log(`Wrote ${OUT}`);
console.log(`  statements: ${statements.length}`);
console.log(`  tables:     ${tables.length}`);
console.log(`  ${tables.join(', ')}`);
