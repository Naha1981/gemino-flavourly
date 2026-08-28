/**
 * GATE V4/V5 — mock of `@neondatabase/serverless`.
 *
 * Active ONLY when GATE_MOCK=1 (the webpack alias in next.config.mjs swaps
 * this module in for the real Neon HTTP driver).
 *
 * In the app there are exactly two consumers of the real module:
 *
 *   - lib/db/index.ts   → fully aliased to pgmem-db.ts, so its neon import
 *     is irrelevant under the gate;
 *   - app/api/migrate/route.ts → uses `const sql = neon(url)` and runs its
 *     static DDL through the tagged template.
 *
 * This mock routes those queries to the SAME pg-mem instance that backs
 * `@/lib/db` (the singleton in pgmem-db.ts), so `GET /api/migrate` executes
 * the app's real production migration code against the gate database. The
 * DDL is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), which is
 * exactly what makes the production endpoint safe to re-run.
 *
 * Security note: the mock does NOT weaken anything — the super-admin gate
 * on the migrate route (`isSuperAdmin()`) still runs for real against the
 * mocked identity, so the harness can prove 403 for non-admin personas.
 */
import { gateDb } from './pgmem-db';

type QueryResult = { rows: unknown[] };

/**
 * Mirrors the neon() factory closely enough for the app's usage. The
 * returned `sql` accepts BOTH invocation forms the driver supports:
 *
 *   - tagged template:  `sql`INSERT ... VALUES ($1)``
 *   - plain string:     `sql(rawSqlString)`
 *
 * The plain-string form is what app/api/migrate/route.ts uses since PR #36
 * (`await sql(stmt.sql)` over the generated BASE_DDL/MIGRATE_DDL arrays),
 * so the mock must handle it exactly like the real driver does.
 */
export function neon(
  _url?: string,
): ((strings: TemplateStringsArray, ...params: unknown[]) => Promise<unknown[]>) &
  ((rawSql: string) => Promise<unknown[]>) {
  const { pool } = gateDb.instance();

  function sql(strings: TemplateStringsArray | string, ...params: unknown[]) {
    // The migrate route uses no parameters; still, build a proper
    // $1..$n query so any future parameterised tagged call works.
    const text =
      typeof strings === 'string'
        ? strings
        : strings.reduce((acc, s, i) => acc + s + (i < params.length ? `$${i + 1}` : ''), '');
    return pool
      .query(text, typeof strings === 'string' ? [] : params)
      .then((res: QueryResult) => res.rows);
  }
  return sql;
}
