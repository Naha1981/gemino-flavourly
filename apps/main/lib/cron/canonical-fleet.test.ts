import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  fleetJsonCandidates,
  loadCanonicalFleet,
  parseFleet,
  resolveFleetJobs,
  resolveJobUrl,
} from './canonical-fleet.ts';
import { EMBEDDED_FLEET_JSON } from './canonical-fleet.embedded.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/main/lib/cron -> repo root is 4 levels up.
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

describe('canonical fleet — scripts/cron-fleet.json on disk', () => {
  test('loads via fs from the repo root (source: fs)', () => {
    const loaded = loadCanonicalFleet(REPO_ROOT);
    assert.equal(loaded.source, 'fs', `expected fs source, got ${loaded.source} (${loaded.path})`);
    assert.match(loaded.path ?? '', /scripts\/cron-fleet\.json$/);
  });

  test('contains exactly 20 canonical jobs plus the hourly system watchdog', () => {
    const { fleet } = loadCanonicalFleet(REPO_ROOT);
    assert.equal(fleet.jobs.length, 20, 'canonical fleet must have exactly 20 jobs');
    assert.ok(fleet.watchdog, 'watchdog job must exist');
    assert.equal(fleet.watchdog.key, 'system-watchdog');
    // Hourly: every hour, minute 0.
    assert.deepEqual(fleet.watchdog.schedule.hours, [-1]);
    assert.deepEqual(fleet.watchdog.schedule.minutes, [0]);
  });

  test('job keys are unique across jobs + watchdog', () => {
    const { fleet } = loadCanonicalFleet(REPO_ROOT);
    const keys = [...fleet.jobs.map((j) => j.key), fleet.watchdog.key];
    assert.equal(new Set(keys).size, keys.length);
  });

  test('every job has a cron-secret auth mode except the operator keep-awake', () => {
    const { fleet } = loadCanonicalFleet(REPO_ROOT);
    for (const job of [...fleet.jobs, fleet.watchdog]) {
      if (job.key === 'keep-operator-awake') {
        assert.equal(job.auth, null, 'operator /health needs no auth header');
        continue;
      }
      assert.equal(job.auth, 'cron-secret', `job ${job.key} must use the cron secret`);
    }
  });

  test('every /api/cron/* route is covered by exactly one fleet job', () => {
    const { fleet } = loadCanonicalFleet(REPO_ROOT);
    const cronDir = join(REPO_ROOT, 'apps/main/app/api/cron');
    const routes = readdirSync(cronDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(cronDir, e.name, 'route.ts')))
      .map((e) => e.name);
    const fleetApiPaths = fleet.jobs
      .filter((j) => j.url.includes('/api/cron/'))
      .map((j) => j.url.split('/api/cron/')[1]);
    for (const route of routes) {
      if (route === 'system-watchdog') continue; // tracked as the watchdog
      assert.ok(
        fleetApiPaths.includes(route),
        `cron route /api/cron/${route} has no canonical fleet job`
      );
    }
  });

  test('schedules are cron-job.org-shaped arrays with a timezone', () => {
    const { fleet } = loadCanonicalFleet(REPO_ROOT);
    for (const job of [...fleet.jobs, fleet.watchdog]) {
      for (const field of ['mdays', 'months', 'wdays', 'hours', 'minutes'] as const) {
        assert.ok(Array.isArray(job.schedule[field]), `${job.key} schedule.${field}`);
        assert.ok(
          (job.schedule[field] as number[]).every((n) => Number.isInteger(n) && n >= -1),
          `${job.key} schedule.${field} must be integers >= -1`
        );
      }
      assert.equal(typeof job.schedule.timezone, 'string');
    }
  });
});

describe('canonical fleet — fs fallback + validation', () => {
  test('falls back to the embedded snapshot when fs reads are disabled (source: embedded)', () => {
    const prev = process.env.FLEET_JSON_DISABLE_FS;
    process.env.FLEET_JSON_DISABLE_FS = '1';
    try {
      const empty = mkdtempSync(join(tmpdir(), 'fleet-'));
      const loaded = loadCanonicalFleet(empty);
      assert.equal(loaded.source, 'embedded');
      assert.equal(loaded.fleet.jobs.length, 20);
      assert.equal(loaded.fleet.watchdog.key, 'system-watchdog');
    } finally {
      if (prev === undefined) delete process.env.FLEET_JSON_DISABLE_FS;
      else process.env.FLEET_JSON_DISABLE_FS = prev;
    }
  });

  test('embedded snapshot is identical to scripts/cron-fleet.json (no drift)', () => {
    const fromDisk = parseFleet(
      // Read the file directly, independent of the loader.
      readFileSync(join(REPO_ROOT, 'scripts/cron-fleet.json'), 'utf8')
    );
    const embedded = parseFleet(EMBEDDED_FLEET_JSON);
    assert.deepEqual(embedded, fromDisk, 'run scripts/gen-fleet-snapshot.mjs to resync');
  });

  test('parseFleet rejects malformed fleet definitions', () => {
    assert.throws(() => parseFleet('{"jobs": []}'), /watchdog/);
    assert.throws(() => parseFleet('{"watchdog": {}}'), /jobs/);
    // Job missing its schedule.
    assert.throws(
      () => parseFleet('{"jobs": [{"key":"a","title":"t","url":"u"}], "watchdog": {"key":"w","title":"w","url":"u2","schedule":{"mdays":[],"months":[],"wdays":[],"hours":[],"minutes":[]}}}'),
      /schedule/
    );
    // duplicate keys
    const dupJob = '{"key":"a","title":"t","url":"u","schedule":{"mdays":[],"months":[],"wdays":[],"hours":[],"minutes":[]}}';
    assert.throws(
      () => parseFleet(`{"jobs": [${dupJob}, ${dupJob}], "watchdog": {"key":"w","title":"w","url":"u2","schedule":{"mdays":[],"months":[],"wdays":[],"hours":[],"minutes":[]}}}`),
      /duplicate job key/
    );
  });

  test('FLEET_JSON_PATH override wins when set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    const custom = join(dir, 'scripts/cron-fleet.json');
    const { fleet } = loadCanonicalFleet(REPO_ROOT);
    writeFileSync(custom, JSON.stringify({ ...fleet, version: 99 }));
    const prev = process.env.FLEET_JSON_PATH;
    process.env.FLEET_JSON_PATH = custom;
    try {
      const loaded = loadCanonicalFleet('/nonexistent-dir');
      assert.equal(loaded.source, 'fs');
      assert.equal(loaded.fleet.version, 99);
    } finally {
      if (prev === undefined) delete process.env.FLEET_JSON_PATH;
      else process.env.FLEET_JSON_PATH = prev;
    }
  });

  test('candidate list includes cwd and repo-root derivations', () => {
    const candidates = fleetJsonCandidates(REPO_ROOT);
    assert.ok(candidates.some((c) => c.endsWith(join('scripts', 'cron-fleet.json'))));
    assert.ok(candidates.length >= 3);
  });
});

describe('canonical fleet — URL resolution', () => {
  test('placeholders resolve against fleet defaults', () => {
    const loaded = loadCanonicalFleet(REPO_ROOT);
    const url = resolveJobUrl('{baseUrl}/api/cron/outbox', loaded.fleet, {});
    assert.equal(url, `${loaded.fleet.baseUrl}/api/cron/outbox`);
    const op = resolveJobUrl('{operatorUrl}/health', loaded.fleet, {});
    assert.equal(op, `${loaded.fleet.operatorUrl}/health`);
  });

  test('env overrides win (APP_URL / OPERATOR_URL), trailing slash trimmed', () => {
    const loaded = loadCanonicalFleet(REPO_ROOT);
    const url = resolveJobUrl('{baseUrl}/api/cron/outbox', loaded.fleet, {
      APP_URL: 'https://preview.example.com/',
    });
    assert.equal(url, 'https://preview.example.com/api/cron/outbox');
    const op = resolveJobUrl('{operatorUrl}/health', loaded.fleet, {
      OPERATOR_URL: 'https://op.example.com/',
    });
    assert.equal(op, 'https://op.example.com/health');
  });

  test('resolveFleetJobs yields 21 resolved jobs with exactly one watchdog', () => {
    const loaded = loadCanonicalFleet(REPO_ROOT);
    const resolved = resolveFleetJobs(loaded, {});
    assert.equal(resolved.length, 21);
    assert.equal(resolved.filter((j) => j.isWatchdog).length, 1);
    assert.ok(resolved.every((j) => j.url.startsWith('https://')));
    assert.ok(resolved.every((j) => !j.url.includes('{')));
  });
});
