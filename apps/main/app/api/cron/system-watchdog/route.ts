import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { loadCanonicalFleet, resolveFleetJobs } from '@/lib/cron/canonical-fleet';
import { resolveStoredCronJobApiKey } from '@/lib/cron/key-store-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_API = 'https://api.cron-job.org';

/**
 * S5 — hourly system watchdog (fleet job 'System Watchdog' in
 * scripts/cron-fleet.json). Checks the things that silently kill the
 * platform when they break:
 *
 *   1. DATABASE_URL still answers (SELECT 1 against Neon);
 *   2. the WhatsApp operator still answers /health (reported, non-fatal);
 *   3. AUTO-HEAL: the cron fleet itself. Canonical jobs that were disabled
 *      (manually or by a cron-job.org glitch) are re-enabled automatically.
 *      The cron-job.org API key is resolved DATABASE-FIRST — the same
 *      encrypted value the Cron Fleet Manager saves from /admin — with the
 *      CRONJOB_API_KEY env fallback. A missing key disables auto-heal only;
 *      the health checks still run.
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
  const operatorUrl = process.env.OPERATOR_URL || 'https://gemino-flavourly-whatsapp.onrender.com';
  try {
    const res = await fetch(`${operatorUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(8_000),
    });
    operatorOk = res.ok;
  } catch {
    operatorOk = false;
  }

  // 3. Fleet auto-heal — re-enable any disabled canonical jobs.
  const autoHeal = { ran: false, reEnabled: 0, disabledFound: 0, error: null as string | null };
  const keyResolution = await resolveStoredCronJobApiKey();
  if (keyResolution.key) {
    autoHeal.ran = true;
    try {
      const fleet = resolveFleetJobs(loadCanonicalFleet());
      const canonicalUrls = new Map(fleet.map((j) => [j.url, j]));
      const headers = {
        Authorization: `Bearer ${keyResolution.key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      const listRes = await fetch(`${CRON_API}/jobs`, { headers, signal: AbortSignal.timeout(8_000) });
      if (listRes.ok) {
        const listData = await listRes.json();
        const remoteJobs: { jobId: number; url: string; enabled: boolean; requestMethod?: number }[] =
          listData?.jobs ?? listData?.cronjobs ?? [];
        for (const remote of remoteJobs) {
          const canonical = canonicalUrls.get(remote.url);
          if (!canonical || remote.enabled) continue;
          autoHeal.disabledFound += 1;
          const cronSecret = process.env.CRON_SECRET ?? '';
          const requestHeaders =
            canonical.auth === 'cron-secret'
              ? [{ name: 'Authorization', value: `Bearer ${cronSecret}` }]
              : [];
          const updateRes = await fetch(`${CRON_API}/jobs/${remote.jobId}`, {
            method: 'PUT',
            headers,
            signal: AbortSignal.timeout(8_000),
            body: JSON.stringify({
              job: {
                title: canonical.title,
                url: canonical.url,
                enabled: true,
                saveResponses: true,
                requestMethod: remote.requestMethod ?? 1,
                requestHeaders,
                schedule: canonical.schedule,
              },
            }),
          });
          if (updateRes.ok || updateRes.status === 201) autoHeal.reEnabled += 1;
        }
        if (autoHeal.reEnabled > 0) {
          console.log(`[system-watchdog] auto-healed ${autoHeal.reEnabled} disabled fleet job(s)`);
        }
      } else {
        autoHeal.error = `cron-job.org list returned HTTP ${listRes.status}`;
      }
    } catch (err) {
      autoHeal.error = err instanceof Error ? err.message : String(err);
      console.error('[system-watchdog] auto-heal failed', autoHeal.error);
    }
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
      autoHeal,
      ...(dbError ? { dbError } : {}),
    },
    { status: ok ? 200 : 503 }
  );
}
