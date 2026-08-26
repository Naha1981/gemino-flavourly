import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * S5 — hourly system watchdog (fleet job 'System Watchdog' in
 * scripts/cron-fleet.json). Checks the two things that silently kill the
 * platform when they break:
 *
 *   1. DATABASE_URL still answers (SELECT 1 against Neon);
 *   2. the WhatsApp operator still answers /health (non-fatal: the operator
 *      is a separate Render service that may cold-start slowly, so its
 *      failure is REPORTED but does not fail the watchdog run).
 *
 * A failed DB check returns 503 so cron-job.org marks the run as failed and
 * alerts fire — a 200-everything-is-fine body would hide exactly the
 * incident the watchdog exists to catch.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const checkedAt = new Date().toISOString();

  // 1. Database liveness.
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
    console.error('[system-watchdog] database check failed', dbError);
  }

  // 2. Operator liveness (best-effort, hard 8s bound).
  let operatorOk: boolean | null = null;
  const operatorUrl = process.env.OPERATOR_URL || 'https://gemino-flavourly-operator.onrender.com';
  try {
    const res = await fetch(`${operatorUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(8_000),
    });
    operatorOk = res.ok;
  } catch {
    operatorOk = false;
  }

  const ok = dbOk;
  return NextResponse.json(
    {
      ok,
      checkedAt,
      checks: {
        database: dbOk,
        operator: operatorOk,
      },
      ...(dbError ? { dbError } : {}),
    },
    { status: ok ? 200 : 503 }
  );
}
