#!/usr/bin/env node
/**
 * Fetch the deployed app's runtime secrets (DATABASE_URL, CLERK_SECRET_KEY)
 * from the Vercel project environment — so the S6 E2E seeder can run with
 * ZERO manual credential copying:
 *
 *   VERCEL_TOKEN=... VERCEL_PROJECT_ID=... node scripts/fetch-deploy-env.mjs
 *
 * Prints shell export lines (values masked in any log you keep). Combine:
 *
 *   eval "$(node scripts/fetch-deploy-env.mjs)" && \
 *     BASE_URL=$PREVIEW_URL node e2e/ship-seed.mjs && \
 *     BASE_URL=$PREVIEW_URL npx playwright test e2e/ship.spec.ts
 */

const VERCEL_API = 'https://api.vercel.com';
const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT;
const TEAM = process.env.VERCEL_ORG_ID || process.env.VERCEL_TEAM_ID;

const WANTED = ['DATABASE_URL', 'CLERK_SECRET_KEY'];

async function vercel(path) {
  const qs = TEAM ? `${path.includes('?') ? '&' : '?'}teamId=${TEAM}` : '';
  const res = await fetch(`${VERCEL_API}${path}${qs}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Vercel ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function main() {
  if (!TOKEN || !PROJECT_ID) {
    console.error('Need VERCEL_TOKEN and VERCEL_PROJECT_ID in the environment.');
    process.exit(1);
  }
  const list = await vercel(`/v10/projects/${PROJECT_ID}/env`);
  const envs = list.envs ?? [];
  const lines = [];
  for (const key of WANTED) {
    const found = envs.find((e) => e.key === key && (e.target ?? []).includes('production'));
    if (!found) {
      console.error(`# ${key}: not found on the Vercel project (production target)`);
      continue;
    }
    const one = await vercel(`/v10/projects/${PROJECT_ID}/env/${found.id}`);
    if (!one.value) {
      console.error(`# ${key}: present but value unreadable`);
      continue;
    }
    lines.push(`export ${key}=${JSON.stringify(one.value)}`);
  }
  if (lines.length === 0) {
    console.error('No runtime secrets resolved — check VERCEL_TOKEN scope/project id.');
    process.exit(1);
  }
  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error('fetch-deploy-env failed:', err.message);
  process.exit(1);
});
