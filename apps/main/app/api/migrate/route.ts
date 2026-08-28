import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { BASE_DDL, BASE_TABLES } from '@/lib/db/base-ddl';
import { MIGRATE_DDL, MIGRATE_TABLES } from '@/lib/db/migrate-ddl';

export const dynamic = 'force-dynamic';

/**
 * Applies the full schema to the production database, idempotently.
 *
 * This is the ONLY migration path available against production: there is no
 * shell in a serverless function and `drizzle-kit` is a devDependency that
 * is not bundled into the Lambda. It therefore has to be able to bootstrap a
 * completely EMPTY database, which is what it could not do before — it began
 * with `ALTER TABLE tenants ...` while the 16 base tables came solely from
 * `drizzle/0000` via drizzle-kit. On a database missing them, the route threw
 * on its first statement ("relation \"tenants\" does not exist") and nothing
 * at all was migrated, leaving every dashboard query failing the same way.
 *
 * The DDL now lives in two generated, executable modules:
 *   - lib/db/base-ddl.ts        (from drizzle/0000_flimsy_mordo.sql)
 *   - lib/db/migrate-ddl.ts     (the incremental statements, extracted
 *                                verbatim from this route's old body)
 * Both are covered by lib/db/migrate-parity.test.ts, which executes them
 * against an in-memory Postgres and asserts parity with lib/db/schema.ts.
 */
export async function GET() {
  // This endpoint runs schema DDL against production. It was previously
  // public and unauthenticated — anyone who found the URL could hit it.
  // Gated the same way as the Super Admin dashboard: staff_members role
  // OR ADMIN_EMAIL/SUPER_ADMIN_EMAILS allowlist, checked via a live Clerk
  // API call rather than session claims.
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  // Base schema first: every incremental statement below assumes those
  // tables exist.
  const statements: { phase: 'base' | 'incremental'; sql: string }[] = [
    ...BASE_DDL.map((sql) => ({ phase: 'base' as const, sql })),
    ...MIGRATE_DDL.map((sql) => ({ phase: 'incremental' as const, sql })),
  ];

  let applied = 0;
  try {
    const sql = neon(dbUrl);

    for (const stmt of statements) {
      await sql(stmt.sql);
      applied++;
    }

    return NextResponse.json({
      ok: true,
      message: 'All Neon database columns and tables synchronized successfully',
      appliedStatements: applied,
      totalStatements: statements.length,
      baseTables: BASE_TABLES.length,
      incrementalTables: MIGRATE_TABLES.length,
    });
  } catch (err: any) {
    // Report the offending statement: with ~190 statements applied in one
    // pass, "Migration failed" alone gives an operator nothing to act on.
    const failing = statements[applied]?.sql ?? '';
    return NextResponse.json(
      {
        error: err.message || 'Migration failed',
        appliedStatements: applied,
        totalStatements: statements.length,
        failedPhase: statements[applied]?.phase ?? null,
        failedStatement: failing.slice(0, 300),
      },
      { status: 500 },
    );
  }
}
