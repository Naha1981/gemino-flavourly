#!/usr/bin/env node
/**
 * S6 — E2E seeding for the ship suite (e2e/ship.spec.ts).
 *
 * Runs BEFORE Playwright against a deployed environment (preview or prod).
 * Everything goes through real product surfaces + official APIs — zero
 * manual UI steps:
 *
 *   1. Clerk Backend API: create three test users (owner, outsider, admin)
 *      and open sessions for them.
 *   2. DATABASE_URL: grant the admin user the staff_members super_admin row
 *      (the same path isSuperAdmin() trusts in production).
 *   3. App API as the admin: import a prospect + build its demo tenant
 *      (POST /api/prospects, POST /api/prospects/[id]/build) -> magic link.
 *   4. App API as the owner: touch /api/tenant/list so a self tenant exists
 *      for the multi-tenant switcher test.
 *
 * Output: .e2e-state.json consumed by ship.spec.ts.
 *
 * Required env: BASE_URL, CLERK_SECRET_KEY, DATABASE_URL.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(HERE, '..', '.e2e-state.json');

const BASE_URL = (process.env.BASE_URL || process.env.E2E_BASE_URL || '').replace(/\/$/, '');
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

function missing() {
  const missingVars = [];
  if (!BASE_URL) missingVars.push('BASE_URL');
  if (!CLERK_SECRET_KEY) missingVars.push('CLERK_SECRET_KEY');
  if (!DATABASE_URL) missingVars.push('DATABASE_URL');
  return missingVars;
}

const CLERK_API = 'https://api.clerk.com/v1';

async function clerk(path, options = {}) {
  const res = await fetch(`${CLERK_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
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
  if (!res.ok) {
    throw new Error(`Clerk ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

async function createTestUser(tag) {
  const runId = process.env.E2E_RUN_ID || Date.now().toString(36);
  const email = `e2e-${tag}-${runId}@e2e.flavourly.test`;
  const password = `E2E-${randomUUID()}`;
  const user = await clerk('/users', {
    method: 'POST',
    body: JSON.stringify({
      email_address: [email],
      password,
      first_name: 'E2E',
      last_name: tag,
    }),
  });

  // Open a session via a real password sign-in.
  const signIn = await clerk('/sign_ins', {
    method: 'POST',
    body: JSON.stringify({ strategy: 'password', identifier: email, password }),
  });
  const sessionId = signIn.created_session_id;
  if (!sessionId) throw new Error(`no session created for ${email}: ${JSON.stringify(signIn).slice(0, 300)}`);
  const { jwt } = await clerk(`/sessions/${sessionId}/token`, { method: 'POST' });
  return { email, password, userId: user.id, sessionId, jwt };
}

async function app(path, jwt, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    redirect: 'manual',
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

async function main() {
  const missingVars = missing();
  if (missingVars.length > 0) {
    console.log(`SKIP-SEED: missing env vars: ${missingVars.join(', ')}`);
    process.exit(0);
  }

  console.log(`[ship-seed] target: ${BASE_URL}`);

  const [owner, outsider, admin] = await Promise.all([
    createTestUser('owner'),
    createTestUser('outsider'),
    createTestUser('admin'),
  ]);
  console.log(`[ship-seed] users: owner=${owner.email} outsider=${outsider.email} admin=${admin.email}`);

  // Grant the admin user super_admin via the staff_members path.
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(DATABASE_URL);
  await sql`DELETE FROM staff_members WHERE clerk_user_id = ${admin.userId}`;
  await sql`INSERT INTO staff_members (clerk_user_id, email, name, role) VALUES (${admin.userId}, ${admin.email}, 'E2E admin', 'super_admin')`;
  console.log('[ship-seed] staff_members super_admin row granted');

  // Build a demo tenant through the product API (super admin).
  const add = await app('/api/prospects', admin.jwt, {
    method: 'POST',
    body: JSON.stringify({
      name: `E2E Ship Kitchen ${Date.now().toString(36)}`,
      website: 'https://example.com',
      city: 'Cape Town',
      ownerEmail: owner.email,
    }),
  });
  if (add.status >= 300) throw new Error(`prospect add failed: ${add.status} ${JSON.stringify(add.data)}`);
  const prospectId = add.data.prospect?.id ?? add.data.id;
  if (!prospectId) throw new Error(`no prospect id in response: ${JSON.stringify(add.data).slice(0, 300)}`);

  const build = await app(`/api/prospects/${prospectId}/build`, admin.jwt, { method: 'POST' });
  if (build.status >= 300) throw new Error(`prospect build failed: ${build.status} ${JSON.stringify(build.data)}`);
  const { tenantId, claimToken, claimLink } = build.data;
  console.log(`[ship-seed] demo tenant built: ${tenantId} (token ${String(claimToken).slice(0, 8)}…)`);

  // Give the owner a self-created tenant too (multi-tenant switcher test).
  const list1 = await app('/api/tenant/list', owner.jwt);
  console.log(`[ship-seed] owner tenants before dashboard: ${JSON.stringify(list1.data)}`);

  const state = {
    baseUrl: BASE_URL,
    seededAt: new Date().toISOString(),
    owner: { email: owner.email, password: owner.password, userId: owner.userId, sessionId: owner.sessionId },
    outsider: { email: outsider.email, password: outsider.password, userId: outsider.userId, sessionId: outsider.sessionId },
    admin: { email: admin.email, password: admin.password, userId: admin.userId, sessionId: admin.sessionId },
    prospect: { id: prospectId, tenantId, claimToken, claimLink },
  };
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`[ship-seed] wrote ${STATE_PATH}`);
}

main().catch((err) => {
  console.error('[ship-seed] FAILED:', err);
  process.exit(1);
});
