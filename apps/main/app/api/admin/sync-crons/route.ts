import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { loadCanonicalFleet, resolveFleetJobs, type ResolvedCronJob } from '@/lib/cron/canonical-fleet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CRON_API = 'https://api.cron-job.org';

/**
 * S5 — GET /api/admin/sync-crons
 *
 * Self-healing cron fleet sync. Super-admin only; uses the CRONJOB_API_KEY
 * server env var (never sent to the browser). Reconciles cron-job.org with
 * the canonical fleet in scripts/cron-fleet.json:
 *
 *   - creates missing canonical jobs (20 jobs + hourly system watchdog);
 *   - updates drifted ones (title / schedule / auth header) and ENABLES
 *     every canonical job that was disabled;
 *   - deletes duplicates (extra jobs sharing a canonical URL) and stale
 *     app-domain jobs that are no longer in the canonical fleet;
 *   - never touches jobs outside the app/operator domains.
 *
 * Returns a table of the resulting state so the console (and ops reports)
 * can verify the fleet at a glance.
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

async function cronApi(path: string, apiKey: string, options: RequestInit = {}) {
  const res = await fetch(`${CRON_API}${path}`, {
    ...options,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  const apiKey = process.env.CRONJOB_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'CRONJOB_API_KEY is not configured on this deployment' },
      { status: 500 }
    );
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on this deployment' },
      { status: 500 }
    );
  }

  const loaded = loadCanonicalFleet();
  const canonical = resolveFleetJobs(loaded);
  const timezone = loaded.fleet.timezone;

  // Fetch the current remote state.
  const list = await cronApi('/jobs', apiKey);
  if (!list.res.ok) {
    return NextResponse.json(
      { error: `cron-job.org rejected the API key (HTTP ${list.res.status})` },
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
  const deleted: { jobId: number; title: string; url: string; reason: 'duplicate' | 'stale' }[] = [];
  const counts = { created: 0, updated: 0, enabled: 0, unchanged: 0, deleted: 0 };

  // 1. Create / update / enable every canonical job.
  for (const job of canonical) {
    const matches = remoteJobs.filter((r) => r.url === job.url);
    const primary = matches[0] ?? null;

    if (!primary) {
      const create = await cronApi('/jobs', apiKey, {
        method: 'PUT',
        body: JSON.stringify(canonicalPayload(job, cronSecret, 1)),
      });
      if (create.res.ok || create.res.status === 201) {
        counts.created += 1;
        table.push({ key: job.key, title: job.title, url: job.url, isWatchdog: job.isWatchdog, jobId: (create.data as { jobId?: number })?.jobId ?? null, action: 'created', enabled: true });
      } else {
        table.push({ key: job.key, title: job.title, url: job.url, isWatchdog: job.isWatchdog, jobId: null, action: 'unchanged', enabled: false });
      }
    } else {
      let action: Action = 'unchanged';
      const drifted =
        primary.title !== job.title ||
        scheduleDrifted(primary, job, timezone) ||
        authDrifted(primary, job, cronSecret);

      if (drifted || !primary.enabled) {
        const method = primary.requestMethod ?? 1;
        const update = await cronApi(`/jobs/${primary.jobId}`, apiKey, {
          method: 'PUT',
          body: JSON.stringify(canonicalPayload(job, cronSecret, method)),
        });
        if (update.res.ok || update.res.status === 201) {
          action = drifted ? 'updated' : 'enabled';
          if (!primary.enabled) counts.enabled += 1;
          if (drifted) counts.updated += 1;
        }
      } else {
        counts.unchanged += 1;
      }

      table.push({
        key: job.key,
        title: job.title,
        url: job.url,
        isWatchdog: job.isWatchdog,
        jobId: primary.jobId,
        action,
        enabled: true,
      });

      // 2. Delete duplicates: extra jobs sharing this canonical URL.
      for (const dupe of matches.slice(1)) {
        const del = await cronApi(`/jobs/${dupe.jobId}`, apiKey, { method: 'DELETE' });
        if (del.res.ok || del.res.status === 204) {
          deleted.push({ jobId: dupe.jobId, title: dupe.title, url: dupe.url, reason: 'duplicate' });
          counts.deleted += 1;
        }
        await sleep(250);
      }
    }
    await sleep(250);
  }

  // 3. Delete stale jobs: on a fleet domain but no longer canonical.
  for (const remote of remoteJobs) {
    const onFleetDomain = fleetDomains.some((d) => remote.url.startsWith(d.replace(/\/$/, '')));
    if (!onFleetDomain) continue; // never touch foreign jobs
    if (canonicalUrls.has(remote.url)) continue;
    const del = await cronApi(`/jobs/${remote.jobId}`, apiKey, { method: 'DELETE' });
    if (del.res.ok || del.res.status === 204) {
      deleted.push({ jobId: remote.jobId, title: remote.title, url: remote.url, reason: 'stale' });
      counts.deleted += 1;
    }
    await sleep(250);
  }

  const watchdogRow = table.find((r) => r.isWatchdog);

  return NextResponse.json({
    ok: true,
    fleetSource: loaded.source,
    canonicalJobCount: canonical.length,
    watchdog: watchdogRow
      ? { title: watchdogRow.title, url: watchdogRow.url, jobId: watchdogRow.jobId, action: watchdogRow.action, enabled: watchdogRow.enabled }
      : null,
    summary: counts,
    deleted,
    table,
  });
}
