import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { loadCanonicalFleet, resolveFleetJobs } from '@/lib/cron/canonical-fleet';
import { resolveStoredCronJobApiKey } from '@/lib/cron/key-store-server';
import { verifyWebhookSignature } from '@/lib/webhook/verify';
import { dispatchQaAlert } from '@/lib/qa/alerts';
import { operatorClient } from '@/lib/operator-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GATE QA-2 — GET /api/cron/qa-sweep (CRON_SECRET bearer).
 *
 * The 10-minute smoke sweep (scheduled on cron-job.org — NEVER vercel.json).
 * Doubles as the Render keep-alive ping: the operator /health probe below
 * touches the WhatsApp engine every run, and the existing
 * "Keep Operator Awake" fleet job (every 5 min) does the same on the
 * operator's own schedule.
 *
 * STRICTLY READ-ONLY against business data. The only write this route can
 * ever perform is an admin_notifications row via the alert pipeline when a
 * check FAILS (that is the pipeline's job, not a business mutation).
 *
 * Checks (owner spec):
 *   key routes 200 · auth gating redirects · operator /health · DB ping ·
 *   webhook HMAC self-test · cron fleet enabled.
 *
 * Response contract: HTTP 200 + ok:true when every CRITICAL check passes
 * (warnings allowed); HTTP 503 + ok:false when any critical check fails —
 * cron-job.org then marks the run failed, which is the external half of
 * the alarm. Every failed check (critical or warning) is dispatched
 * through lib/qa/alerts.ts: email + admin notification, deduped 6h.
 */

interface SweepCheck {
  ok: boolean;
  /** critical failures flip the response to 503; warnings only alert. */
  critical: boolean;
  detail: string;
}

const CRON_API = 'https://api.cron-job.org';

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(ms),
      redirect: 'manual',
      ...init,
    });
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const origin = req.nextUrl.origin;
  const checks: Record<string, SweepCheck> = {};

  // ── 1. Key public routes answer 200 ─────────────────────────────────
  const publicRoutes: [string, string][] = [
    ['landing', '/'],
    ['pricing', '/pricing'],
    ['sign-in', '/sign-in'],
    ['api-health', '/api/health'],
  ];
  for (const [name, path] of publicRoutes) {
    const res = await fetchWithTimeout(`${origin}${path}`, 10_000);
    checks[name] = {
      ok: res !== null && res.status === 200,
      critical: true,
      detail: res === null ? 'unreachable (timeout/network)' : `HTTP ${res.status}`,
    };
  }

  // ── 2. Auth gating: protected routes are NOT reachable anonymously ──
  // Two equally-valid fail-closed shapes:
  //   - production (real Clerk middleware): 3xx redirect to /sign-in;
  //   - the GATE_MOCK harness (Clerk protect() semantics, pinned by
  //     e2e/gate-v4-v5 J2.2): 404 — the page is simply not served.
  const gatedRoutes: [string, string][] = [
    ['dashboard-auth-gate', '/dashboard'],
    ['admin-auth-gate', '/admin'],
  ];
  for (const [name, path] of gatedRoutes) {
    const res = await fetchWithTimeout(`${origin}${path}`, 10_000, {
      headers: { 'user-agent': 'flavourly-qa-sweep' },
    });
    const location = res?.headers.get('location') ?? '';
    const redirected = res !== null && res.status >= 300 && res.status < 400 && /sign-in/i.test(location);
    const protected404 = res !== null && res.status === 404;
    checks[name] = {
      ok: redirected || protected404,
      critical: true,
      detail:
        res === null
          ? 'unreachable (timeout/network)'
          : `HTTP ${res.status}${location ? ` → ${location}` : ' (Clerk protect: not served anonymously)'}`,
    };
  }

  // ── 3. Operator /health — the Render keep-alive ping (warning) ──────
  const operatorOk = await operatorClient.checkHealth(8_000).catch(() => false);
  checks['operator'] = {
    ok: operatorOk,
    critical: false,
    detail: operatorOk ? 'healthy' : `${process.env.OPERATOR_URL || 'http://localhost:3001'}/health unreachable`,
  };

  // ── 4. Database ping ────────────────────────────────────────────────
  let dbOk = false;
  let dbDetail = 'ok';
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch (err: any) {
    dbDetail = err?.message ?? String(err);
  }
  checks['database'] = { ok: dbOk, critical: true, detail: dbOk ? 'ok' : dbDetail };

  // ── 5. Webhook HMAC self-test (real crypto, both directions) ────────
  const webhookSecret = process.env.WEBHOOK_SECRET;
  let hmacOk = false;
  let hmacDetail: string;
  if (!webhookSecret) {
    hmacDetail = 'WEBHOOK_SECRET not configured — inbound webhook verification would fail closed';
  } else {
    const hmacEnv: NodeJS.ProcessEnv = { ...process.env, WEBHOOK_SECRET: webhookSecret };
    const payload = JSON.stringify({ selftest: true, at: new Date().toISOString() });
    const goodSig = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
    const verified = verifyWebhookSignature(payload, goodSig, hmacEnv);
    const tamperedRejected = !verifyWebhookSignature(`${payload} `, goodSig, hmacEnv);
    hmacOk = verified && tamperedRejected;
    hmacDetail = hmacOk
      ? 'valid signature accepted, tampered payload rejected'
      : `verified=${verified}, tamperedRejected=${tamperedRejected}`;
  }
  checks['webhook-hmac'] = { ok: hmacOk, critical: true, detail: hmacDetail };

  // ── 6. Cron fleet enabled (warning; best-effort against cron-job.org)
  let fleetOk = false;
  let fleetDetail: string;
  try {
    const loaded = loadCanonicalFleet();
    const canonical = resolveFleetJobs(loaded);
    const keyResolution = await resolveStoredCronJobApiKey();
    if (!keyResolution.key) {
      fleetDetail = `cron-job.org API key not configured (fleet source: ${loaded.source}) — set it in /admin → Cron Fleet Manager`;
    } else {
      const res = await fetchWithTimeout(`${CRON_API}/jobs`, 8_000, {
        headers: {
          Authorization: `Bearer ${keyResolution.key}`,
          Accept: 'application/json',
        },
      });
      if (!res || !res.ok) {
        fleetDetail = `cron-job.org list failed (HTTP ${res?.status ?? 'unreachable'})`;
      } else {
        const data = await res.json().catch(() => ({}));
        const remoteJobs: { url: string; enabled: boolean }[] = data?.jobs ?? data?.cronjobs ?? [];
        const byUrl = new Map(remoteJobs.map((j) => [j.url, j]));
        const missing: string[] = [];
        const disabled: string[] = [];
        for (const job of canonical) {
          const remote = byUrl.get(job.url);
          if (!remote) missing.push(job.key);
          else if (!remote.enabled) disabled.push(job.key);
        }
        fleetOk = missing.length === 0 && disabled.length === 0;
        fleetDetail = fleetOk
          ? `${canonical.length} canonical jobs enabled (fleet source: ${loaded.source})`
          : `missing: [${missing.join(', ')}] disabled: [${disabled.join(', ')}]`;
      }
    }
  } catch (err: any) {
    fleetDetail = err?.message ?? String(err);
  }
  checks['cron-fleet'] = { ok: fleetOk, critical: false, detail: fleetDetail };

  // ── Dispatch alerts for every failed check (deduped 6h per check) ───
  const alerts: { check: string; dispatched: boolean; emailStatus: string }[] = [];
  for (const [name, check] of Object.entries(checks)) {
    if (check.ok) continue;
    const result = await dispatchQaAlert({
      severity: check.critical ? 'critical' : 'warning',
      check: `qa-sweep/${name}`,
      message: `${check.detail}\nRaised by the 10-minute QA smoke sweep against ${origin}.`,
      reportUrl: origin,
    });
    alerts.push({ check: name, dispatched: result.dispatched, emailStatus: result.emailStatus });
  }

  const criticalOk = Object.values(checks).every((c) => c.ok || !c.critical);
  const body = {
    ok: criticalOk,
    checkedAt: new Date().toISOString(),
    origin,
    checks,
    alerts,
  };
  return NextResponse.json(body, { status: criticalOk ? 200 : 503 });
}
