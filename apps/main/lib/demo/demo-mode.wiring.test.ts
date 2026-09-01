import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * GATE 2 — Demo Mode wiring (source inspection, same convention as the
 * repo's other wiring suites).
 *
 * Runtime behavior of the toggle needs the full Clerk + Next stack (the
 * browser evidence harness covers that end-to-end). What these tests
 * lock in is the STRUCTURE that makes the gate's guarantees hold:
 *
 *  1. The server never trusts the cookie alone — isDemoModeActive must
 *     fail closed through isSuperAdmin after the cookie fast-path.
 *  2. The Super Admin overview, Inbox, and Reputation pages all branch
 *     on isDemoModeActive and render the amber banner when active.
 *  3. The tenant pages only render the banner when demo mode is ACTIVE
 *     (standard tenants — who can never activate it — see nothing).
 *  4. The live-table seeder (deadbeef rows) stays strictly separate
 *     from the view-only demo mode.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const COMPONENTS = join(HERE, '..', '..', 'components');

const demoMode = readFileSync(join(HERE, 'demo-mode.ts'), 'utf8');
const adminPage = readFileSync(join(APP, '(app)', 'admin', 'page.tsx'), 'utf8');
const inboxPage = readFileSync(join(APP, '(app)', 'dashboard', 'inbox', 'page.tsx'), 'utf8');
const reputationPage = readFileSync(join(APP, '(app)', 'dashboard', 'reputation', 'page.tsx'), 'utf8');
const demoBar = readFileSync(join(COMPONENTS, 'demo-mode-bar.tsx'), 'utf8');

describe('demo-mode gate — fails closed for standard tenants', () => {
  test('cookie fast-path, then isSuperAdmin verification (never cookie alone)', () => {
    assert.match(demoMode, /isSuperAdmin/);
    assert.match(demoMode, /!== 'on'/); // fast path returns false without the cookie
  });
});

describe('admin overview wiring', () => {
  test('branches on isDemoModeActive and renders the bar', () => {
    assert.match(adminPage, /isDemoModeActive/);
    assert.match(adminPage, /<DemoModeBar active=\{demoMode\} \/>/);
  });

  test('business-metric queries are skipped in demo mode', () => {
    // The tenant-count query must be guarded, proving zero live reads.
    assert.match(adminPage, /demoMode \? \[\{ count: 0 \}\] : await db\.select/);
  });

  test('uses the seed dataset for KPIs and the tenants table', () => {
    assert.match(adminPage, /DEMO_PLATFORM_KPIS/);
    assert.match(adminPage, /DEMO_TENANTS/);
  });
});

describe('tenant dashboard wiring (Inbox + Reputation)', () => {
  test('inbox branches on demo mode with seeded conversations/VIPs and the banner', () => {
    assert.match(inboxPage, /isDemoModeActive/);
    assert.match(inboxPage, /DEMO_CONVERSATIONS/);
    assert.match(inboxPage, /DEMO_VIPS/);
    assert.match(inboxPage, /\{demoMode && <DemoModeBar active \/>\}/);
  });

  test('reputation branches on demo mode with seeded reviews and the banner', () => {
    assert.match(reputationPage, /isDemoModeActive/);
    assert.match(reputationPage, /DEMO_REVIEWS/);
    assert.match(reputationPage, /\{demoMode && <DemoModeBar active \/>\}/);
  });

  test('standard tenants never see a toggle on tenant pages (banner only when active)', () => {
    // The unconditional compact toggle exists ONLY on the admin page —
    // tenant pages must gate the bar behind `demoMode &&`.
    assert.doesNotMatch(inboxPage, /<DemoModeBar active=\{demoMode\}/);
    assert.doesNotMatch(reputationPage, /<DemoModeBar active=\{demoMode\}/);
  });
});

describe('toggle component contract', () => {
  test('persists via cookie and refreshes server components', () => {
    assert.match(demoBar, /document\.cookie/);
    assert.match(demoBar, /router\.refresh/);
    assert.match(demoBar, /gemino_demo_mode=on/);
    assert.match(demoBar, /data-testid="demo-mode-toggle"/);
  });

  test('QA-2: switching ON ensures the busy-restaurant seed via /api/admin/demo-view first', () => {
    // Owner spec: the toggle inside the Super Admin portal must fill the
    // dashboards with seed data — not just flip the view cookie over
    // whatever happens to be loaded.
    assert.match(demoBar, /\/api\/admin\/demo-view/);
    assert.match(demoBar, /enabled: true/);
    // Fail-open to the cookie flip: a dead route must not brick the toggle.
    assert.match(demoBar, /catch/);
  });

  test('the ensure-seed route is super-admin gated and idempotent', () => {
    const route = readFileSync(join(APP, 'api', 'admin', 'demo-view', 'route.ts'), 'utf8');
    assert.match(route, /isSuperAdmin/);
    assert.match(route, /403/);
    assert.match(route, /seedDemoData/);
    // Only seeds when the dataset is not already loaded.
    assert.match(route, /demoSeedActive/);
  });

  test('banner carries the demo warning and the switch-to-live action', () => {
    assert.match(demoBar, /data-testid="demo-mode-banner"/);
    assert.match(demoBar, /Switch to Live Data/);
    assert.match(demoBar, /DEMO DATA/);
  });
});
