import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import {
  loadCanonicalFleet,
  resolveFleetJobs,
  cronExpression,
  type ResolvedCronJob,
} from '@/lib/cron/canonical-fleet';
import { resolveStoredCronJobApiKey } from '@/lib/cron/key-store-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CRON_API = 'https://api.cron-job.org';
/** Hard UI deadline: never leave the Fleet Manager hanging longer than this. */
const SYNC_DEADLINE_MS = 30_000;
/** Per-request bound against a slow cron-job.org. */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * S5 + Cron Fleet Manager — GET /api/admin/sync-crons
 *
 * Self-healing cron fleet sync. Super-admin only. The cron-job.org API key
 * is resolved DATABASE-FIRST (system_settings.cronjob_api_key, saved from
 * the /admin UI — no Vercel redeploy needed to rotate it) with the
 * process.env.CRONJOB_API_KEY environment fallback.
 *
 * Reconciles cron-job.org with the canonical fleet in
 * scripts/cron-fleet.json: creates missing jobs, updates drifted ones,
 * ENABLES every disabled canonical job, deletes duplicates and stale
 * app-domain jobs, and returns a UI-friendly table of the resulting state.
 * Bounded by a 30-second deadline so the UI never hangs.
 */

interface RemoteJob {
  jobId: number;
  title: string;
  url: string;
  enabled: boolean;
  requestMethod?: number;
  requestHeaders?: { name: string; value: string }[];
  schedule?: {
    mdays: number[];
    months: number[];
    wdays: number[];
    hours: number[];
    minutes: number[];
    timezone?: string;
    expiresAt?: number;
  };
}

type Action = 'created' | 'updated' | 'enabled' | 'unchanged';

interface TableRow {
  key: string;
  title: string;
  url: string;
  isWatchdog: boolean;
  jobId: number | null;
  action: Action;
  enabled: boolean;
}

interface UiJobRow {
  name: string;
  key: string;
  url: string;
  jobId: number | null;
  status: 'enabled' | 'missing';
  schedule: string;
  action: Action;
  isWatchdog: boolean;
}

async function cronApi(path: string, apiKey: string, options: RequestInit = {}) {
  const res = await fetch(`${CRON_API}${path}`, {
    ...options,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { res, data, text };
}

function normalizeSchedule(schedule: NonNullable<RemoteJob['schedule']>, timezone: string) {
  return JSON.stringify({
    mdays: schedule.mdays ?? [-1],
    months: schedule.months ?? [-1],
    wdays: schedule.wdays ?? [-1],
    hours: schedule.hours ?? [-1],
    minutes: schedule.minutes ?? [0],
    timezone: schedule.timezone ?? timezone,
    expiresAt: schedule.expiresAt ?? 0,
  });
}

function canonicalPayload(job: ResolvedCronJob, cronSecret: string, requestMethod: number) {
  const headers =
    job.auth === 'cron-secret' ? [{ name: 'Authorization', value: `Bearer ${cronSecret}` }] : [];
  return {
    job: {
      title: job.title,
      url: job.url,
      enabled: true,
      saveResponses: true,
      requestMethod,
      requestHeaders: headers,
      schedule: job.schedule,
    },
  };
}

function scheduleDrifted(existing: RemoteJob, canonical: ResolvedCronJob, timezone: string): boolean {
  if (!existing.schedule) return true;
  return normalizeSchedule(existing.schedule, timezone) !== normalizeSchedule(canonical.schedule, timezone);
}

function authDrifted(existing: RemoteJob, canonical: ResolvedCronJob, cronSecret: string): boolean {
  const current = existing.requestHeaders?.find((h) => h.name === 'Authorization')?.value ?? '';
  const expected = canonical.auth === 'cron-secret' ? `Bearer ${cronSecret}` : '';
  return current !== expected;
}

export async function GET() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  // DATABASE-FIRST key resolution (UI-driven fleet management). Fallback:
  // the CRONJOB_API_KEY deployment env var (process.env.CRONJOB_API_KEY).
  const resolvedKey = await resolveStoredCronJobApiKey();
  if (!resolvedKey.key) {
    return NextResponse.json(
      {
        success: false,
        error:
          'cron-job.org API key is not configured. Save it from /admin → Cron Fleet Manager, or set the CRONJOB_API_KEY environment variable.',
      },
      { status: 500 }
    );
  }
  const apiKey = resolvedKey.key;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: 'CRON_SECRET is not configured on this deployment' },
      { status: 500 }
    );
  }

  const loaded = loadCanonicalFleet();
  const canonical = resolveFleetJobs(loaded);
  const timezone = loaded.fleet.timezone;

  const deadline = Date.now() + SYNC_DEADLINE_MS;
  let timedOut = false;
  const withinBudget = () => {
    if (Date.now() > deadline) {
      timedOut = true;
      return false;
    }
    return true;
  };

  // Fetch the current remote state.
  const list = await cronApi('/jobs', apiKey);
  if (!list.res.ok) {
    return NextResponse.json(
      { success: false, error: `cron-job.org rejected the API key (HTTP ${list.res.status})` },
      { status: 502 }
    );
  }
  const remoteJobs: RemoteJob[] =
    (list.data as { jobs?: RemoteJob[] })?.jobs ??
    (list.data as { cronjobs?: RemoteJob[] })?.cronjobs ??
    [];

  const canonicalUrls = new Set(canonical.map((j) => j.url));
  const fleetDomains = [loaded.fleet.baseUrl, loaded.fleet.operatorUrl];

  const table: TableRow[] = [];
  const jobsUi: UiJobRow[] = [];
  const deleted: { jobId: number; title: string; url: string; reason: 'duplicate' | 'stale' }[] = [];
  const counts = { created: 0, updated: 0, enabled: 0, unchanged: 0, deleted: 0 };

  // 1. Create / update / enable every canonical job.
  for (const job of canonical) {
    if (!withinBudget()) break;
    const matches = remoteJobs.filter((r) => r.url === job.url);
    const primary = matches[0] ?? null;

    let action: Action = 'unchanged';
    let jobId: number | null = null;
    let enabledState = false;

    if (!primary) {
      const create = await cronApi('/jobs', apiKey, {
        method: 'PUT',
        body: JSON.stringify(canonicalPayload(job, cronSecret, 1)),
      });
      if (create.res.ok || create.res.status === 201) {
        action = 'created';
        counts.created += 1;
        jobId = (create.data as { jobId?: number })?.jobId ?? null;
        enabledState = true;
      }
    } else {
      jobId = primary.jobId;
      const drifted =
        primary.title !== job.title ||
        scheduleDrifted(primary, job, timezone) ||
        authDrifted(primary, job, cronSecret);

      if (drifted || !primary.enabled) {
        const update = await cronApi(`/jobs/${primary.jobId}`, apiKey, {
          method: 'PUT',
          body: JSON.stringify(canonicalPayload(job, cronSecret, primary.requestMethod ?? 1)),
        });
        if (update.res.ok || update.res.status === 201) {
          action = drifted ? 'updated' : 'enabled';
          if (drifted) counts.updated += 1;
          if (!primary.enabled) counts.enabled += 1;
          enabledState = true;
        }
      } else {
        counts.unchanged += 1;
        enabledState = true;
      }

      // 2. Delete duplicates: extra jobs sharing this canonical URL.
      for (const dupe of matches.slice(1)) {
        if (!withinBudget()) break;
        const del = await cronApi(`/jobs/${dupe.jobId}`, apiKey, { method: 'DELETE' });
        if (del.res.ok || del.res.status === 204) {
          deleted.push({ jobId: dupe.jobId, title: dupe.title, url: dupe.url, reason: 'duplicate' });
          counts.deleted += 1;
        }
      }
    }

    table.push({ key: job.key, title: job.title, url: job.url, isWatchdog: job.isWatchdog, jobId, action, enabled: enabledState });
    jobsUi.push({
      name: job.title,
      key: job.key,
      url: job.url,
      jobId,
      status: enabledState ? 'enabled' : 'missing',
      schedule: cronExpression(job.schedule),
      action,
      isWatchdog: job.isWatchdog,
    });
  }

  // 3. Delete stale jobs: on a fleet domain but no longer canonical.
  if (!timedOut) {
    for (const remote of remoteJobs) {
      if (!withinBudget()) break;
      const onFleetDomain = fleetDomains.some((d) => remote.url.startsWith(d.replace(/\/$/, '')));
      if (!onFleetDomain) continue; // never touch foreign jobs
      if (canonicalUrls.has(remote.url)) continue;
      const del = await cronApi(`/jobs/${remote.jobId}`, apiKey, { method: 'DELETE' });
      if (del.res.ok || del.res.status === 204) {
        deleted.push({ jobId: remote.jobId, title: remote.title, url: remote.url, reason: 'stale' });
        counts.deleted += 1;
      }
    }
  }

  const watchdogRow = jobsUi.find((r) => r.isWatchdog);
  const activeCount = jobsUi.filter((j) => j.status === 'enabled').length;

  return NextResponse.json({
    // UI-friendly payload (Cron Fleet Manager)
    success: !timedOut,
    message: timedOut
      ? `Sync hit the 30s deadline after activating ${activeCount}/${canonical.length} jobs — run it again to finish.`
      : `Fleet synced successfully: ${activeCount}/${canonical.length} jobs active`,
    keySource: resolvedKey.source,
    summary: { ...counts, active: activeCount, total: canonical.length },
    jobs: jobsUi,
    timedOut,
    // Legacy/compat fields
    ok: !timedOut,
    fleetSource: loaded.source,
    canonicalJobCount: canonical.length,
    watchdog: watchdogRow
      ? { title: watchdogRow.name, url: watchdogRow.url, jobId: watchdogRow.jobId, action: watchdogRow.action, enabled: watchdogRow.status === 'enabled' }
      : null,
    deleted,
    table,
  });
}
