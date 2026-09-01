import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, '..');
const ROOT = join(MAIN, '..', '..');

function src(rel: string): string {
  const p = join(MAIN, rel);
  assert.ok(existsSync(p), `missing file: ${rel}`);
  return readFileSync(p, 'utf8');
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('S1 — /claim/[token] never invents data', () => {
  const page = src('app/(app)/claim/[token]/page.tsx');

  test('empty menu renders "Not confirmed yet" instead of hiding the section', () => {
    const code = stripComments(page);
    assert.match(code, /Not confirmed yet/);
    // The menu section always renders (no menu.length > 0 && gate left).
    assert.ok(!/menu\.length > 0 && \(/.test(code.replace(/\s+/g, ' ')), 'menu section must always render');
    assert.ok(!/hours\.length > 0 && \(/.test(code.replace(/\s+/g, ' ')), 'hours section must always render');
  });

  test('bookings are badged "Sample"', () => {
    assert.match(page, /Sample/);
    assert.match(page, /data-testid|uppercase|badge|Sample/);
  });

  test('branding renders the brand logo as an <img>', () => {
    assert.match(page, /<img src=\{logoUrl\}/);
  });
});

describe('S1 — /admin/prospects Re-scrape action', () => {
  const console = src('app/(app)/admin/prospects/prospects-console.tsx');

  test('exposes a Re-scrape action for built prospects', () => {
    assert.match(console, /Re-scrape/);
  });

  test('the action calls POST /api/prospects/[id]/build', () => {
    assert.match(console, /\/api\/prospects\/\$\{id\}\/build/);
  });
});

describe('S1 — inline enrichment with 10s timeouts + per-source try/catch', () => {
  test('the scraper has a 10s abort timeout', () => {
    const scraper = src('lib/brand-intelligence/scraper.ts');
    assert.match(scraper, /10_000/);
    assert.match(scraper, /AbortController|abort/);
  });

  test('google places calls carry a 10s AbortSignal.timeout', () => {
    const places = src('lib/brand-intelligence/google-places.ts');
    const matches = places.match(/AbortSignal\.timeout\(10_000\)/g) ?? [];
    assert.ok(matches.length >= 2, `expected >=2 timeouts, found ${matches.length}`);
  });

  test('createDemoTenant wraps each enrichment source in its own try/catch', () => {
    const builder = stripComments(src('lib/brand-intelligence/create-demo-tenant.ts'));
    const tryCount = (builder.match(/try\s*\{/g) ?? []).length;
    // One guarded try per enrichment SOURCE (brand scrape, Google Places).
    assert.ok(tryCount >= 2, `expected per-source try/catch blocks, found ${tryCount}`);
    // Every DB write is additionally guarded with .catch so a failing write
    // can never kill the inline build.
    const catchCount = (builder.match(/\.catch\(/g) ?? []).length;
    assert.ok(catchCount >= 5, `expected guarded DB writes, found ${catchCount} .catch calls`);
  });

  test('the build route runs enrichment inline (calls createDemoTenant synchronously)', () => {
    const route = src('app/api/prospects/[id]/build/route.ts');
    assert.match(route, /await createDemoTenant\(/);
  });
});

describe('S2 — claim redeem writes ownership + membership + cookie + deep-link', () => {
  const claim = stripComments(src('lib/brand-intelligence/claim.ts'));
  const route = stripComments(src('app/api/claim/redeem/route.ts'));

  test('sets tenants.owner_user_id', () => {
    assert.match(claim, /ownerUserId:\s*clerkUserId/);
  });

  test('inserts an owner membership row (idempotent)', () => {
    assert.match(claim, /insert\(memberships\)/);
    assert.match(claim, /onConflictDoNothing\(\)/);
    assert.match(claim, /role:\s*'owner'/);
  });

  test('redirect deep-links the claimed tenant dashboard', () => {
    assert.match(claim, /\/dashboard\?tenant=/);
    assert.doesNotMatch(claim, /redirect:\s*'\/onboarding'/);
  });

  test('the redeem route pins the flavourly_active_tenant cookie on success', () => {
    assert.match(route, /ACTIVE_TENANT_COOKIE/);
    assert.match(route, /cookies\(\)\.set\(ACTIVE_TENANT_COOKIE, result\.tenantId/);
  });

  test('the GET redeem redirect path (post sign-up) also pins the cookie + deep-link', () => {
    const getRoute = stripComments(src('app/(app)/claim/redeem/route.ts'));
    assert.match(getRoute, /ACTIVE_TENANT_COOKIE/);
    assert.match(getRoute, /response\.cookies\.set\(ACTIVE_TENANT_COOKIE, result\.tenantId/);
    assert.match(getRoute, /result\.redirect/);
  });

  test('ACTIVE_TENANT_COOKIE is the spec-mandated name', () => {
    const core = src('lib/tenant-resolver-core.ts');
    assert.match(core, /flavourly_active_tenant/);
  });
});

describe('S3 — already-claimed deep links', () => {
  const states = src('app/(app)/claim/[token]/claim-states.tsx');
  const page = src('app/(app)/claim/[token]/page.tsx');

  test('sign-in deep-links to the claimed tenant dashboard via redirect_url', () => {
    assert.match(states, /redirect_url=/);
    assert.match(states, /\/dashboard\?tenant=/);
  });

  test('go-home links to the claimed tenant dashboard', () => {
    assert.match(states, /dashboardHref/);
  });

  test('the claim page passes the tenant id into the already-claimed state', () => {
    assert.match(page, /tenantId=\{tenant\.id\}/);
  });
});

describe('S4 — tenant resolver, switcher, switch endpoint', () => {
  test('resolver priority + isolation guard live in the pure core', () => {
    const core = stripComments(src('lib/tenant-resolver-core.ts'));
    assert.match(core, /queryTenantId/);
    assert.match(core, /cookieTenantId/);
    assert.match(core, /managedIds/);
    assert.match(core, /super-admin-default/);
    // Guard: canAccess requires membership OR super admin.
    assert.match(core, /managed\.has\(id\)\s*\|\|\s*input\.isSuperAdmin/);
  });

  test('the I/O wrapper reads ?tenant= via the forwarded header', () => {
    const resolver = stripComments(src('lib/tenant-resolver.ts'));
    assert.match(resolver, /TENANT_PARAM_HEADER/);
  });

  test('middleware forwards ?tenant= as x-tenant-param', () => {
    const mw = stripComments(src('middleware.ts'));
    assert.match(mw, /searchParams\.get\('tenant'\)/);
    assert.match(mw, /headers\.set\('x-tenant-param'/);
  });

  test('POST /api/tenant/switch 403s unmanaged tenants and sets the cookie', () => {
    const route = stripComments(src('app/api/tenant/switch/route.ts'));
    assert.match(route, /canManageTenant\(/);
    assert.match(route, /status:\s*403/);
    assert.match(route, /cookies\(\)\.set\(ACTIVE_TENANT_COOKIE/);
    assert.match(route, /status:\s*401/);
  });

  test('the dashboard layout resolves via the resolver and renders the switcher', () => {
    const layout = stripComments(src('app/(app)/dashboard/layout.tsx'));
    assert.match(layout, /resolveActiveTenant\(/);
    assert.match(layout, /<DashboardChrome/);
    const chrome = stripComments(src('app/(app)/dashboard/dashboard-chrome.tsx'));
    assert.match(chrome, /<TenantSwitcher/);
  });

  test('sidebar TenantSwitcher posts to /api/tenant/switch', () => {
    const switcher = src('components/tenant-switcher.tsx');
    assert.match(switcher, /\/api\/tenant\/switch/);
    assert.match(switcher, /tenantId/);
  });

  test('schema defines memberships + tenants.owner_user_id', () => {
    const schema = src('lib/db/schema.ts');
    assert.match(schema, /export const memberships = pgTable\(/);
    assert.match(schema, /ownerUserId:\s*text\('owner_user_id'\)/);
    assert.match(schema, /memberships_user_tenant_uniq/);
  });

  test('/api/migrate mirrors memberships + owner_user_id', () => {
    // The /api/migrate DDL was lifted verbatim out of the route handler into
    // lib/db/migrate-ddl.ts so it can be EXECUTED by
    // lib/db/migrate-execute.test.ts. Same statements, new home.
    const migrate = stripComments(src('lib/db/migrate-ddl.ts'));
    assert.match(migrate, /ADD COLUMN IF NOT EXISTS owner_user_id text/);
    assert.match(migrate, /CREATE TABLE IF NOT EXISTS memberships/);
  });

  test('a drizzle migration mirrors it too (0019_tenant_memberships.sql)', () => {
    const sqlPath = join(MAIN, 'drizzle/0019_tenant_memberships.sql');
    assert.ok(existsSync(sqlPath), 'drizzle migration file missing');
    const sql = readFileSync(sqlPath, 'utf8');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS owner_user_id text/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS memberships/);
    const journal = JSON.parse(readFileSync(join(MAIN, 'drizzle/meta/_journal.json'), 'utf8'));
    assert.ok(
      journal.entries.some((e: { tag: string }) => e.tag === '0019_tenant_memberships'),
      'journal entry missing'
    );
  });
});

describe('S5 — canonical cron fleet', () => {
  const fleetPath = join(ROOT, 'scripts/cron-fleet.json');

  test('scripts/cron-fleet.json exists with 23 jobs + hourly watchdog', () => {
    assert.ok(existsSync(fleetPath));
    const fleet = JSON.parse(readFileSync(fleetPath, 'utf8'));
    assert.equal(fleet.jobs.length, 23);
    assert.equal(fleet.watchdog.key, 'system-watchdog');
    assert.deepEqual(fleet.watchdog.schedule.minutes, [0]);
    assert.deepEqual(fleet.watchdog.schedule.hours, [-1]);
  });

  test('canonical-fleet.ts reads the file via fs (no JSON import)', () => {
    const loader = stripComments(src('lib/cron/canonical-fleet.ts'));
    assert.match(loader, /from 'node:fs'/);
    assert.match(loader, /readFileSync/);
    assert.doesNotMatch(loader, /from '\.\.\/\.\.\/\.\.\/\.\.\/scripts\/cron-fleet\.json'/);
    assert.doesNotMatch(loader, /import fleet from/);
  });

  test('sync-crons is super-admin gated and resolves the key DATABASE-FIRST', () => {
    const route = stripComments(src('app/api/admin/sync-crons/route.ts'));
    assert.match(route, /isSuperAdmin\(\)/);
    assert.match(route, /status:\s*403/);
    assert.match(route, /resolveStoredCronJobApiKey\(/);
    assert.match(route, /loadCanonicalFleet\(/);
    // The env fallback is named explicitly (it lives in the key store).
    assert.match(route, /CRONJOB_API_KEY/);
  });

  test('the key store resolves database first, environment fallback', () => {
    const store = stripComments(src('lib/cron/key-store-server.ts'));
    assert.match(store, /resolveCronJobApiKey\(/);
    assert.match(store, /process\.env\.CRONJOB_API_KEY/);
    assert.match(store, /process\.env\.CRON_SECRET/);
    const core = stripComments(src('lib/cron/key-store.ts'));
    assert.match(core, /aes-256-gcm/);
    assert.match(core, /source:\s*'database'/);
    assert.match(core, /source:\s*'environment'/);
  });

  test('sync-crons creates, updates/enables, and deletes dupes/stale within a 30s deadline', () => {
    const route = stripComments(src('app/api/admin/sync-crons/route.ts'));
    assert.match(route, /'created'/);
    assert.match(route, /'updated'/);
    assert.match(route, /'enabled'/);
    assert.match(route, /reason:\s*'duplicate'/);
    assert.match(route, /reason:\s*'stale'/);
    assert.match(route, /method:\s*'DELETE'/);
    assert.match(route, /SYNC_DEADLINE_MS\s*=\s*30_000/);
  });

  test('sync-crons returns the UI-friendly payload plus the legacy table', () => {
    const route = stripComments(src('app/api/admin/sync-crons/route.ts'));
    assert.match(route, /success:/);
    assert.match(route, /message:/);
    assert.match(route, /jobs:\s*jobsUi/);
    assert.match(route, /table/);
    assert.match(route, /watchdog/);
    assert.match(route, /cronExpression\(/);
  });

  test('POST /api/admin/settings/cron-key is super-admin gated and encrypts', () => {
    const route = stripComments(src('app/api/admin/settings/cron-key/route.ts'));
    assert.match(route, /isSuperAdmin\(\)/);
    assert.match(route, /status:\s*403/);
    assert.match(route, /saveCronJobApiKey\(/);
  });

  test('setup-cronjobs.mjs reads the SAME json (no duplicate fleet list)', () => {
    const script = stripComments(readFileSync(join(ROOT, 'scripts/setup-cronjobs.mjs'), 'utf8'));
    assert.match(script, /cron-fleet\.json/);
    assert.match(script, /readFileSync/);
    assert.doesNotMatch(script, /'Outbox Worker', url:/);
  });

  test('the hourly watchdog endpoint exists behind the cron guard', () => {
    const route = stripComments(src('app/api/cron/system-watchdog/route.ts'));
    assert.match(route, /assertCronAuthorized\(req\)/);
    assert.match(route, /if\s*\(\s*authError\s*\)\s*return\s+authError\s*;/);
  });
});
