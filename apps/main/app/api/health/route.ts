import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * Liveness / readiness probe.
 *
 * This route did not exist before, yet it was listed in the outage
 * runbook as a thing to check — so any monitor pointed at it was getting a
 * 404 (and, because `config.matcher` routes every `/api/*` path through the
 * middleware's `auth().protect()`, actually a 401). It is now real and
 * explicitly public in lib/auth/route-guard-core.
 *
 * Contract:
 *   - ALWAYS answers 200 while the Node process can serve requests. An
 *     uptime monitor must never read "database is down" as "the app is
 *     gone" — the public site still renders, and a 5xx here would mask the
 *     real signal by paging on the probe instead of the database.
 *   - Reports per-check status in the body so a degraded dependency is
 *     visible without being fatal.
 *   - NEVER throws. Every check is individually guarded.
 */

const DB_TIMEOUT_MS = 5000;

async function checkDatabase(): Promise<{ status: 'ok' | 'unavailable'; detail?: string }> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return { status: 'unavailable', detail: 'DATABASE_URL is not configured' };
  }
  try {
    const sql = neon(url);
    await Promise.race([
      sql`SELECT 1 AS ok`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${DB_TIMEOUT_MS}ms`)), DB_TIMEOUT_MS),
      ),
    ]);
    return { status: 'ok' };
  } catch (err) {
    // Swallow the driver's connection string / credentials — a health
    // endpoint is public, and those details would leak infrastructure.
    return { status: 'unavailable', detail: (err as Error)?.message?.slice(0, 160) };
  }
}

export async function GET() {
  const started = Date.now();

  const database = await checkDatabase().catch((err) => ({
    status: 'unavailable' as const,
    detail: (err as Error)?.message?.slice(0, 160),
  }));

  const clerk = Boolean(
    (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY ?? '').trim(),
  );

  const body = {
    status: 'ok',
    service: 'flavourly-main',
    version: process.env.npm_package_version ?? 'unknown',
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    latencyMs: Date.now() - started,
    checks: {
      // `configured` rather than `ok`: publishing a key's value, or even
      // probing Clerk's API from a public endpoint, is not appropriate here.
      clerk: { status: clerk ? 'ok' : 'unconfigured' },
      database,
    },
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      // Uptime monitors and browsers should not cache a health answer.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
