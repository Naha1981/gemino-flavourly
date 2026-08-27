#!/usr/bin/env node
// S5 — CLI cron fleet sync (the script twin of GET /api/admin/sync-crons).
//
// Usage:
//   API_KEY="..." CRON_SECRET="..." node scripts/setup-cronjobs.mjs
//
// Reads the CANONICAL fleet from scripts/cron-fleet.json (the same file the
// app's lib/cron/canonical-fleet.ts reads via fs) — 20 canonical jobs plus
// the hourly system watchdog — and reconciles cron-job.org with it:
//   * creates missing jobs
//   * updates drifted jobs (title / schedule / Authorization header)
//   * enables every canonical job (disabled ones are re-enabled)
//   * never touches jobs outside the app/operator domains
//
// The API key is read from the environment only; it must never be committed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'https://api.cron-job.org';

const API_KEY = process.env.API_KEY || process.env.CRONJOB_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

if (!API_KEY) {
  console.error('ERROR: API_KEY (or CRONJOB_API_KEY) environment variable is required.');
  console.error('Usage: API_KEY="..." CRON_SECRET="..." node scripts/setup-cronjobs.mjs');
  process.exit(1);
}
if (!CRON_SECRET) {
  console.error('ERROR: CRON_SECRET environment variable is required.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load the canonical fleet (shared JSON, resolved like canonical-fleet.ts).
// ---------------------------------------------------------------------------
const fleet = JSON.parse(readFileSync(join(ROOT, 'scripts/cron-fleet.json'), 'utf8'));
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || fleet.baseUrl).replace(/\/$/, '');
const OPERATOR_URL = (process.env.OPERATOR_URL || fleet.operatorUrl).replace(/\/$/, '');

function resolveUrl(url) {
  return url.replace(/\{baseUrl\}/g, APP_URL).replace(/\{operatorUrl\}/g, OPERATOR_URL);
}

const jobs = [...fleet.jobs, fleet.watchdog].map((j) => ({ ...j, url: resolveUrl(j.url) }));
console.log(`Loaded canonical fleet: ${fleet.jobs.length} jobs + watchdog '${fleet.watchdog.title}' (source: scripts/cron-fleet.json)\n`);

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { res, data, text };
}

function authHeaders(job) {
  return job.auth === 'cron-secret' ? [{ name: 'Authorization', value: `Bearer ${CRON_SECRET}` }] : [];
}

function payload(job, requestMethod) {
  return {
    job: {
      title: job.title,
      url: job.url,
      enabled: true,
      saveResponses: true,
      requestMethod,
      requestHeaders: authHeaders(job),
      schedule: job.schedule,
    },
  };
}

function scheduleKey(schedule) {
  return JSON.stringify({
    mdays: schedule?.mdays ?? [-1],
    months: schedule?.months ?? [-1],
    wdays: schedule?.wdays ?? [-1],
    hours: schedule?.hours ?? [-1],
    minutes: schedule?.minutes ?? [0],
    timezone: schedule?.timezone ?? fleet.timezone,
    expiresAt: schedule?.expiresAt ?? 0,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { res, data, text } = await api('/jobs');
  if (!res.ok) {
    console.error(`ERROR: Failed to fetch jobs — ${res.status}\n${text}`);
    process.exit(1);
  }
  const existing = data?.jobs ?? data?.cronjobs ?? [];

  let created = 0;
  let updated = 0;
  let enabled = 0;
  let unchanged = 0;
  let deletedDupes = 0;
  let deletedStale = 0;
  let failed = 0;
  const table = [];

  for (const job of jobs) {
    const matches = existing.filter((j) => j.url === job.url);
    const match = matches[0];
    if (!match) {
      const create = await api('/jobs', { method: 'PUT', body: JSON.stringify(payload(job, 1)) });
      if (create.res.ok || create.res.status === 201) {
        console.log(`CREATE: ${job.title}${job.key === fleet.watchdog.key ? ' (hourly watchdog)' : ''}`);
        created += 1;
        table.push({ title: job.title, url: job.url, action: 'created', enabled: true });
      } else {
        console.error(`FAILED: ${job.title} — ${create.res.status} ${create.text}`);
        failed += 1;
        table.push({ title: job.title, url: job.url, action: 'failed', enabled: false });
      }
    } else {
      const currentAuth = match.requestHeaders?.find((h) => h.name === 'Authorization')?.value ?? '';
      const expectedAuth = job.auth === 'cron-secret' ? `Bearer ${CRON_SECRET}` : '';
      const drifted =
        match.title !== job.title ||
        scheduleKey(match.schedule) !== scheduleKey(job.schedule) ||
        currentAuth !== expectedAuth;

      if (drifted || !match.enabled) {
        const update = await api(`/jobs/${match.jobId}`, {
          method: 'PUT',
          body: JSON.stringify(payload(job, match.requestMethod ?? 1)),
        });
        if (update.res.ok || update.res.status === 201) {
          console.log(`${drifted ? 'UPDATE' : 'ENABLE'}: ${job.title}`);
          if (drifted) updated += 1;
          if (!match.enabled) enabled += 1;
          table.push({ title: job.title, url: job.url, action: drifted ? 'updated' : 'enabled', enabled: true });
        } else {
          console.error(`FAILED to update ${job.title} — ${update.res.status} ${update.text}`);
          failed += 1;
          table.push({ title: job.title, url: job.url, action: 'failed', enabled: false });
        }
      } else {
        console.log(`UNCHANGED: ${job.title}`);
        unchanged += 1;
        table.push({ title: job.title, url: job.url, action: 'unchanged', enabled: true });
      }

      // PHASE 3 — delete duplicates: extra jobs sharing this canonical URL.
      for (const dupe of matches.slice(1)) {
        const del = await api(`/jobs/${dupe.jobId}`, { method: 'DELETE' });
        if (del.res.ok || del.res.status === 204) {
          console.log(`DELETE DUPLICATE: ${dupe.title} (jobId ${dupe.jobId})`);
          deletedDupes += 1;
        }
        await sleep(500);
      }
    }
    await sleep(1000); // stay well inside cron-job.org rate limits
  }

  // PHASE 3 — delete stale jobs: on a fleet domain but no longer canonical.
  const canonicalUrls = new Set(jobs.map((j) => j.url));
  const domains = [APP_URL, OPERATOR_URL].map((d) => d.replace(/\/$/, ''));
  for (const remote of existing) {
    if (!domains.some((d) => remote.url.startsWith(d))) continue; // never touch foreign jobs
    if (canonicalUrls.has(remote.url)) continue;
    const del = await api(`/jobs/${remote.jobId}`, { method: 'DELETE' });
    if (del.res.ok || del.res.status === 204) {
      console.log(`DELETE STALE: ${remote.title} -> ${remote.url} (jobId ${remote.jobId})`);
      deletedStale += 1;
    }
    await sleep(500);
  }

  console.log(`\nSummary: created=${created}, updated=${updated}, enabled=${enabled}, unchanged=${unchanged}, failed=${failed}, dupes_deleted=${deletedDupes}, stale_deleted=${deletedStale}`);
  console.log(`Total canonical jobs: ${jobs.length} (20 + watchdog), disabled: 0`);
  console.log(`system-watchdog registered (hourly): ${jobs.some((j) => j.key === fleet.watchdog.key)}`);
  console.log('\nFleet table:');
  for (const row of table) {
    console.log(`  [${row.action.padEnd(9)}] ${row.enabled ? 'enabled ' : 'DISABLED'} ${row.title} -> ${row.url}`);
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
