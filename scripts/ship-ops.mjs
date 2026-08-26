#!/usr/bin/env node
/**
 * FLAVOURLY S1–S7 — automated ops runner (THEN steps 1–4).
 *
 * Zero manual steps: give it credentials as env vars, it does the rest and
 * prints a JSON report. Safe to run from ANY environment with internet
 * (Codespaces, a CI runner, or the Arena sandbox if its egress allows).
 *
 * Required env:
 *   VERCEL_TOKEN            Vercel account token (vercel.com/account/tokens)
 *   VERCEL_PROJECT_ID       gemino-flavourly-whatsapp project id
 *   CRONJOB_API_KEY         cron-job.org API key
 *   CRON_SECRET             shared cron bearer secret
 * Optional env:
 *   VERCEL_ORG_ID / VERCEL_TEAM_ID   (only for team-scoped projects)
 *   APP_URL                 defaults to https://gemino-flavourly-whatsapp.vercel.app
 *   SKIP_REDEPLOY=1         don't trigger a production redeploy
 *
 * Steps:
 *   1. Ensure CRONJOB_API_KEY + CRON_SECRET exist on the Vercel project for
 *      production AND preview (create or update; never duplicates).
 *   2. Redeploy production so the env is live (unless SKIP_REDEPLOY=1).
 *   3. Bootstrap an ops super-admin session (Clerk Backend API + Neon
 *      staff_members row — both values read from Vercel project env, so
 *      nothing extra is required), then run GET /api/migrate on the
 *      production app (memberships + owner_user_id must exist).
 *   4. GET /api/admin/sync-crons with that session → verify 20 canonical
 *      jobs + hourly watchdog enabled.
 *   5. POST /api/cron/process-prospects with Bearer CRON_SECRET → expect 200.
 *
 * Usage:
 *   VERCEL_TOKEN=... VERCEL_PROJECT_ID=... CRONJOB_API_KEY=... CRON_SECRET=... \
 *     node scripts/ship-ops.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = (process.env.APP_URL || 'https://gemino-flavourly-whatsapp.vercel.app').replace(/\/$/, '');
const VERCEL_API = 'https://api.vercel.com';
const CLERK_API = 'https://api.clerk.com/v1';

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT;
const TEAM = process.env.VERCEL_ORG_ID || process.env.VERCEL_TEAM_ID;
const CRONJOB_API_KEY = process.env.CRONJOB_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const report = {
  envSync: null,
  redeploy: null,
  migrate: null,
  syncCrons: null,
  cronSmoke: null,
};

function fail(step, message) {
  report[step] = { ok: false, error: message };
  console.error(`[ship-ops] ${step}: ${message}`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Vercel API helpers
// ---------------------------------------------------------------------------
async function vercel(path, options = {}) {
  const qs = TEAM ? `${path.includes('?') ? '&' : '?'}teamId=${TEAM}` : '';
  const res = await fetch(`${VERCEL_API}${path}${qs}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function ensureVercelEnv(key, value) {
  const list = await vercel(`/v10/projects/${VERCEL_PROJECT_ID}/env`);
  if (list.status !== 200) throw new Error(`list env failed: ${list.status} ${JSON.stringify(list.data).slice(0, 200)}`);
  const envs = list.data.envs ?? [];
  const existing = envs.filter((e) => e.key === key);

  const target = ['production', 'preview'];
  if (existing.length === 0) {
    const created = await vercel(`/v10/projects/${VERCEL_PROJECT_ID}/env`, {
      method: 'POST',
      body: JSON.stringify({ key, value, target, type: 'encrypted' }),
    });
    if (created.status >= 300) throw new Error(`create ${key} failed: ${created.status} ${JSON.stringify(created.data).slice(0, 200)}`);
    return 'created';
  }

  // Keep exactly one entry; update value/targets on the first, drop extras.
  const [primary, ...dupes] = existing;
  for (const dupe of dupes) {
    await vercel(`/v10/projects/${VERCEL_PROJECT_ID}/env/${dupe.id}`, { method: 'DELETE' });
  }
  const patched = await vercel(`/v10/projects/${VERCEL_PROJECT_ID}/env/${primary.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ value, target }),
  });
  if (patched.status >= 300) throw new Error(`update ${key} failed: ${patched.status} ${JSON.stringify(patched.data).slice(0, 200)}`);
  return 'updated';
}

async function getVercelEnvValue(key) {
  const list = await vercel(`/v10/projects/${VERCEL_PROJECT_ID}/env`);
  const envs = list.data.envs ?? [];
  const found = envs.find((e) => e.key === key);
  if (!found) return null;
  const one = await vercel(`/v10/projects/${VERCEL_PROJECT_ID}/env/${found.id}`);
  return one.data?.value ?? null;
}

async function redeployProduction() {
  const list = await vercel(`/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=1&state=READY`);
  const latest = (list.data?.deployments ?? [])[0];
  if (!latest) throw new Error('no READY deployment found to redeploy');
  const re = await vercel(`/v13/deployments/${latest.uid}/redeploy`, { method: 'POST', body: JSON.stringify({}) });
  if (re.status >= 300) throw new Error(`redeploy failed: ${re.status} ${JSON.stringify(re.data).slice(0, 200)}`);
  return { url: re.data?.url ?? latest.url, uid: re.data?.id ?? latest.uid };
}

// ---------------------------------------------------------------------------
// Clerk / DB bootstrap for the super-admin ops session
// ---------------------------------------------------------------------------
async function clerk(path, secretKey, options = {}) {
  const res = await fetch(`${CLERK_API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (res.status >= 300) throw new Error(`Clerk ${path} -> ${res.status}: ${String(text).slice(0, 250)}`);
  return data;
}

async function app(path, bearerJwt, options = {}) {
  const res = await fetch(`${APP_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${bearerJwt}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    redirect: 'manual',
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function bootstrapOpsSession() {
  const clerkKey = await getVercelEnvValue('CLERK_SECRET_KEY');
  if (!clerkKey) throw new Error('CLERK_SECRET_KEY not found in Vercel project env');
  const dbUrl = await getVercelEnvValue('DATABASE_URL');
  if (!dbUrl) throw new Error('DATABASE_URL not found in Vercel project env');

  // One dedicated ops user (idempotent by stable email).
  const email = `ops+ship@${APP_URL.replace(/^https?:\/\//, '')}.bot`;
  const password = `ShipOps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let user;
  try {
    user = await clerk('/users', clerkKey, {
      method: 'POST',
      body: JSON.stringify({ email_address: [email], password, first_name: 'Ship', last_name: 'Ops' }),
    });
  } catch (err) {
    // Already exists: look it up and reset its password so we can sign in.
    const found = await clerk(`/users?email_address=${encodeURIComponent(email)}`, clerkKey);
    user = Array.isArray(found) ? found[0] : found.data?.[0];
    if (!user) throw err;
    await clerk(`/users/${user.id}`, clerkKey, { method: 'PATCH', body: JSON.stringify({ password }) });
  }

  // Grant super_admin via the staff_members path (same one isSuperAdmin uses).
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(dbUrl);
  await sql`DELETE FROM staff_members WHERE clerk_user_id = ${user.id}`;
  await sql`INSERT INTO staff_members (clerk_user_id, email, name, role) VALUES (${user.id}, ${email}, 'Ship Ops', 'super_admin')`;

  const signIn = await clerk('/sign_ins', clerkKey, {
    method: 'POST',
    body: JSON.stringify({ strategy: 'password', identifier: email, password }),
  });
  const sessionId = signIn.created_session_id;
  if (!sessionId) throw new Error(`no session created for ops user: ${JSON.stringify(signIn).slice(0, 250)}`);
  const { jwt } = await clerk(`/sessions/${sessionId}/token`, clerkKey, { method: 'POST' });
  return { jwt, userId: user.id, email };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const missing = [];
  if (!VERCEL_TOKEN) missing.push('VERCEL_TOKEN');
  if (!VERCEL_PROJECT_ID) missing.push('VERCEL_PROJECT_ID');
  if (!CRONJOB_API_KEY) missing.push('CRONJOB_API_KEY');
  if (!CRON_SECRET) missing.push('CRON_SECRET');
  if (missing.length) fail('envSync', `missing env vars: ${missing.join(', ')}`);

  console.log(`[ship-ops] app: ${APP_URL}`);

  // Sanity: canonical fleet file is present and shaped correctly.
  const fleet = JSON.parse(readFileSync(join(ROOT, 'scripts/cron-fleet.json'), 'utf8'));
  if (fleet.jobs.length !== 20 || fleet.watchdog?.key !== 'system-watchdog') {
    fail('envSync', 'scripts/cron-fleet.json malformed (need 20 jobs + system-watchdog)');
  }

  // 1. Env sync.
  try {
    const a = await ensureVercelEnv('CRONJOB_API_KEY', CRONJOB_API_KEY);
    const b = await ensureVercelEnv('CRON_SECRET', CRON_SECRET);
    report.envSync = { ok: true, CRONJOB_API_KEY: a, CRON_SECRET: b };
    console.log(`[ship-ops] env synced: CRONJOB_API_KEY=${a}, CRON_SECRET=${b}`);
  } catch (err) {
    fail('envSync', String(err.message || err));
  }

  // 2. Redeploy production.
  if (process.env.SKIP_REDEPLOY === '1') {
    report.redeploy = { ok: true, skipped: true };
  } else {
    try {
      report.redeploy = { ok: true, ...(await redeployProduction()) };
      console.log(`[ship-ops] redeployed: ${report.redeploy.url}`);
    } catch (err) {
      fail('redeploy', String(err.message || err));
    }
  }

  // 3. /api/migrate with an automated super-admin session.
  let jwt = null;
  try {
    const session = await bootstrapOpsSession();
    jwt = session.jwt;
    const mig = await app('/api/migrate', jwt);
    if (mig.status !== 200 || mig.data?.ok !== true) {
      fail('migrate', `HTTP ${mig.status}: ${JSON.stringify(mig.data).slice(0, 250)}`);
    }
    report.migrate = { ok: true, response: mig.data };
    console.log('[ship-ops] /api/migrate ok:', mig.data.message ?? '');
  } catch (err) {
    fail('migrate', String(err.message || err));
  }

  // 4. sync-crons.
  try {
    const sync = await app('/api/admin/sync-crons', jwt);
    if (sync.status !== 200 || sync.data?.ok !== true) {
      fail('syncCrons', `HTTP ${sync.status}: ${JSON.stringify(sync.data).slice(0, 250)}`);
    }
    const jobs = sync.data.table ?? [];
    const watchdog = sync.data.watchdog;
    const enabledCount = jobs.filter((j) => j.enabled).length;
    report.syncCrons = {
      ok: jobs.length === 21 && enabledCount === 21 && !!watchdog?.enabled,
      canonicalJobCount: sync.data.canonicalJobCount,
      jobs: jobs.length,
      enabled: enabledCount,
      watchdogEnabled: !!watchdog?.enabled,
      fleetSource: sync.data.fleetSource,
      summary: sync.data.summary,
    };
    console.log(`[ship-ops] sync-crons: ${jobs.length} jobs (${enabledCount} enabled), watchdog=${watchdog?.enabled}`);
    if (!report.syncCrons.ok) fail('syncCrons', 'fleet did not reconcile to 21 enabled jobs');
  } catch (err) {
    fail('syncCrons', String(err.message || err));
  }

  // 5. cron smoke.
  try {
    const res = await fetch(`${APP_URL}/api/cron/process-prospects`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const body = await res.text();
    report.cronSmoke = { ok: res.status === 200, status: res.status, body: body.slice(0, 200) };
    console.log(`[ship-ops] process-prospects: HTTP ${res.status} ${body.slice(0, 120)}`);
    if (res.status !== 200) fail('cronSmoke', `expected 200, got ${res.status}`);
  } catch (err) {
    fail('cronSmoke', String(err.message || err));
  }

  console.log('\n[ship-ops] REPORT:');
  console.log(JSON.stringify(report, null, 2));
  const allOk = Object.values(report).every((r) => r?.ok);
  console.log(allOk ? '\nALL OPS GREEN — safe to squash-merge the PR.' : '\nOPS INCOMPLETE — do not merge.');
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('[ship-ops] fatal:', err);
  process.exit(1);
});
