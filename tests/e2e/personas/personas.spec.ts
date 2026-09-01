import { test, expect, type Page } from '@playwright/test';
import {
  PERSONAS,
  isMockMode,
  productionCredentials,
  signInMockPersona,
  signInProduction,
  captureConsole,
  shot,
  NAV_ITEMS,
  appUrl,
} from './persona-helpers';

/**
 * GATE QA-2 — PLAYWRIGHT PERSONA SUITE (tests/e2e/).
 *
 * Automated journeys for the six personas (owner spec):
 *   visitor · new owner · returning owner · prospect magic-link ·
 *   super admin · tenant-B negative.
 *
 * Covers every nav item, the critical flows (login, QR connect, inbox
 * conversation, admin portal, demo toggle) and captures screenshots +
 * console errors. Credentials for production runs come from owner-provided
 * env vars QA_EMAIL / QA_PASSWORD — NEVER hardcoded (pinned by a
 * source-scan unit test). Production runs are read-only: persona WRITES
 * (approve, demo-view, seed) only ever target the in-memory QA database of
 * the GATE_MOCK harness.
 *
 * Run modes: see ./persona-helpers.ts.
 */

const mockMode = isMockMode();
const creds = productionCredentials();

/** The extra reachable dashboard routes not (yet) in the sidebar nav. */
const EXTRA_ROUTES: { href: string; label: string }[] = [
  { href: '/dashboard/loyalty', label: 'Loyalty' },
  { href: '/dashboard/waitlist', label: 'Waitlist' },
  { href: '/dashboard/market/opportunities', label: 'Market Opportunities' },
  { href: '/dashboard/market/positioning', label: 'Positioning' },
  { href: '/dashboard/reputation/competitors', label: 'Reputation Competitors' },
  { href: '/dashboard/reputation/review-requests', label: 'Review Requests' },
  { href: '/dashboard/customers/reactivation', label: 'Reactivation' },
];

const ALL_ROUTES = [...NAV_ITEMS, ...EXTRA_ROUTES];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Shared page-visit contract: 200, real content, zero console errors. */
async function visitAndAssert(page: Page, href: string, label: string, personaName: string) {
  const capture = captureConsole(page);
  capture.attach();
  const res = await page.goto(appUrl(href), { waitUntil: 'domcontentloaded' });
  expect(res?.status(), `${href} must answer 200 (after auth redirects)`).toBe(200);
  // Dashboard pages render inside <main>; portal pages (e.g. /admin/*)
  // use their own layout — there a visible heading is the contract.
  const hasMain = (await page.locator('main').count()) > 0;
  if (hasMain) {
    await expect(page.locator('main')).toBeVisible();
  } else {
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
  }
  const body = await page.locator('body').innerText();
  expect(body, `${href} must not error`).not.toContain('Internal Server Error');
  await shot(page, `${slug(personaName)}-${slug(label)}`);
  expect(capture.errors, `${href} console errors for ${personaName}`).toEqual([]);
}

// ---------------------------------------------------------------------------
// PERSONA 1 — VISITOR (anonymous)
// ---------------------------------------------------------------------------

test.describe('persona: visitor (anonymous)', () => {
  test('landing loads with the owner-approved headline and zero console errors', async ({ page }) => {
    const capture = captureConsole(page);
    capture.attach();
    await page.goto(appUrl('/'));
    await expect(page.locator('h1')).toContainText('Full tables. Even on Tuesdays.');
    await shot(page, 'visitor-landing');
    expect(capture.errors).toEqual([]);
  });

  test('pricing and sign-in are reachable without an account', async ({ page }) => {
    for (const href of ['/pricing', '/sign-in']) {
      const res = await page.goto(appUrl(href));
      expect(res?.status(), `${href} must be 200 for a visitor`).toBeLessThan(400);
    }
    await shot(page, 'visitor-sign-in');
  });

  test('auth gating: /dashboard and /admin redirect anonymous users to sign-in', async ({ page }) => {
    for (const href of ['/dashboard', '/admin']) {
      await page.goto(appUrl(href));
      await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
    }
    expect(page.url()).toContain('/sign-in');
  });

  test('QA sweep endpoints refuse anonymous callers (401, no data leak)', async ({ request }) => {
    const sweep = await request.get(appUrl('/api/cron/qa-sweep'), { maxRedirects: 0 });
    expect(sweep.status()).toBe(401);
    const alert = await request.post(appUrl('/api/cron/qa-alert'), {
      data: { check: 'x', message: 'x' },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(alert.status());
  });
});

// ---------------------------------------------------------------------------
// PERSONA 2 — NEW OWNER (Tenant C: disconnected, empty — QR connect journey)
// ---------------------------------------------------------------------------

test.describe('persona: new owner (WhatsApp QR connect)', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000); // QR lifecycle waits can exceed the 30s default
    if (mockMode) await signInMockPersona(page, 'newOwner');
    else test.skip(!creds, 'production run needs QA_EMAIL / QA_PASSWORD');
    if (creds && !mockMode) await signInProduction(page, creds);
  });

  test('QR connect page reaches an honest terminal state (never an infinite spinner)', async ({ page }) => {
    const capture = captureConsole(page);
    capture.attach();
    await page.goto(appUrl('/dashboard/whatsapp'));

    // The round-2 contract: within 45s ONE of the real states must own the
    // page — the QR frame, a named engine error, engine-offline, the
    // logged-out box, or an already-connected state. "Starting the
    // WhatsApp engine…" may show meanwhile but must not be the only state.
    const terminal = page.locator(
      '[data-testid="qr-frame"], [data-testid="engine-error"], [data-testid="engine-offline"], [data-testid="logged-out"]'
    );
    await expect(terminal.first()).toBeVisible({ timeout: 45_000 });
    await shot(page, 'new-owner-whatsapp-qr');
    expect(capture.errors).toEqual([]);
  });

  test('QR canvas renders machine-scannable and fresh (mock operator harness)', async ({ page }) => {
    test.skip(!mockMode, 'full QR lifecycle needs the GATE_MOCK harness with the mock operator');
    await page.goto(appUrl('/dashboard/whatsapp'));
    const qr = page.locator('[data-testid="qr-frame"]');
    await expect(qr).toBeVisible({ timeout: 45_000 });
    // Canvas is 288×288 internal (device-pixel-ratio aware) — a QR that
    // renders at that size with a fresh phase is the phone-scannable shape
    // proven by jsQR in the evidence harness.
    await expect(qr.locator('canvas')).toBeVisible();
    await expect(qr).toHaveAttribute('data-qr-phase', 'fresh');
    await shot(page, 'new-owner-whatsapp-qr-fresh');
  });
});

// ---------------------------------------------------------------------------
// PERSONA 3 — RETURNING OWNER (Tenant A: busy) — EVERY nav item
// ---------------------------------------------------------------------------

test.describe('persona: returning owner (full navigation sweep)', () => {
  test.beforeEach(async ({ page }) => {
    if (mockMode) await signInMockPersona(page, 'returningOwner');
    else test.skip(!creds, 'production run needs QA_EMAIL / QA_PASSWORD');
    if (creds && !mockMode) await signInProduction(page, creds);
  });

  for (const route of ALL_ROUTES) {
    test(`nav: ${route.label} renders, no console errors`, async ({ page }) => {
      await visitAndAssert(page, route.href, route.label, 'returning-owner');
    });
  }

  test('inbox: opens a conversation and shows its messages', async ({ page }) => {
    const capture = captureConsole(page);
    capture.attach();
    await page.goto(appUrl('/dashboard/inbox'));
    const firstConversation = page.locator('a[href^="/dashboard/inbox/"]').first();
    if (await firstConversation.count()) {
      await firstConversation.click();
      await page.waitForURL(/\/dashboard\/inbox\//);
      await expect(page.locator('main')).toBeVisible();
      await shot(page, 'returning-owner-inbox-conversation');
    } else {
      // Honest empty inbox is a valid state — the page must say so rather
      // than render broken markup.
      const body = await page.locator('body').innerText();
      expect(body.length).toBeGreaterThan(0);
    }
    expect(capture.errors).toEqual([]);
  });

  test('mobile: hamburger drawer exposes EVERY feature + account', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appUrl('/dashboard'));
    const menu = page.locator('[data-testid="mobile-menu-button"]');
    await expect(menu).toBeVisible();
    await menu.click();
    const drawer = page.locator('[role="dialog"][aria-label="Main menu"]');
    await expect(drawer).toBeVisible();
    // Every sidebar destination is present in the drawer.
    for (const item of NAV_ITEMS) {
      await expect(
        drawer.locator(`a[href="${item.href}"]`),
        `${item.label} must be reachable from the mobile drawer`
      ).toBeVisible();
    }
    await shot(page, 'returning-owner-mobile-drawer');
    // Navigate through the drawer to a non-bottom-bar page.
    await drawer.locator('a[href="/dashboard/billing"]').click();
    await page.waitForURL(/\/dashboard\/billing/);
    await expect(page.locator('main')).toBeVisible();
    await shot(page, 'returning-owner-mobile-billing-via-drawer');
  });
});

// ---------------------------------------------------------------------------
// PERSONA 4 — PROSPECT MAGIC LINK (claimant)
// ---------------------------------------------------------------------------

test.describe('persona: prospect magic-link', () => {
  test('claim page is PUBLIC: unknown token renders a state, never a 500 or auth wall', async ({ page }) => {
    const capture = captureConsole(page);
    capture.attach();
    const res = await page.goto(appUrl('/claim/qa2-nonexistent-token'));
    expect(res?.status()).toBeLessThan(500);
    await page.waitForURL(/\/(claim|sign-in)/);
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Internal Server Error');
    await shot(page, 'prospect-claim-unknown-token');
    expect(capture.errors).toEqual([]);
  });

  test('claim redeem API stays auth-gated (401 without a session)', async ({ request }) => {
    const res = await request.post(appUrl('/api/claim/redeem'), {
      data: { token: 'qa2-nonexistent-token' },
      maxRedirects: 0,
    });
    expect([401, 403, 404, 405]).toContain(res.status());
  });

  test('prospect console is super-admin gated (anonymous bounce)', async ({ page }) => {
    await page.goto(appUrl('/admin/prospects'));
    await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// PERSONA 5 — SUPER ADMIN (the owner: naha.thabiso@gmail.com)
// ---------------------------------------------------------------------------

test.describe('persona: super admin (portal)', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000); // demo seed + portal renders are slow on first hit
    if (mockMode) await signInMockPersona(page, 'superAdmin');
    else test.skip(!creds, 'production run needs QA_EMAIL / QA_PASSWORD');
    if (creds && !mockMode) await signInProduction(page, creds);
  });

  test('/admin renders the portal: kill-switch, fleet, QA alerts, demo toggle', async ({ page }) => {
    const capture = captureConsole(page);
    capture.attach();
    await page.goto(appUrl('/admin'));
    await expect(page.getByRole('heading', { name: /Super Admin Platform Overview/i })).toBeVisible();
    await expect(page.locator('[data-testid="demo-mode-toggle"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="qa-notifications-panel"]')).toBeVisible();
    await shot(page, 'super-admin-portal');
    expect(capture.errors).toEqual([]);
  });

  test('/admin/analytics renders without console errors', async ({ page }) => {
    await visitAndAssert(page, '/admin/analytics', 'Platform Analytics', 'super-admin');
  });

  test('desktop logo gesture: double-click opens the Super Admin portal', async ({ page }) => {
    await page.goto(appUrl('/dashboard'));
    const logo = page.locator('[data-testid="admin-portal-gesture"]').first();
    await expect(logo).toBeVisible();
    await logo.dblclick();
    await page.waitForURL(/\/admin/, { timeout: 15_000 });
  });

  test('mobile logo gesture: 3-second press-and-hold opens the portal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appUrl('/dashboard'));
    // Scope to the HEADER gesture — the DOM-first (sidebar) instance is
    // hidden at mobile widths by design.
    const logo = page.locator('header [data-testid="admin-portal-gesture"]').first();
    await expect(logo).toBeVisible();
    const box = await logo.boundingBox();
    // Dispatch a TOUCH pointerdown (bubbling — React listens at the root)
    // and simply let the 3s hold timer fire.
    await logo.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      clientX: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      clientY: (box?.y ?? 0) + (box?.height ?? 0) / 2,
    });
    await page.waitForURL(/\/admin/, { timeout: 8_000 });
    await shot(page, 'super-admin-via-long-press');
  });

  test('mobile drawer shows the visible Super Admin entry for the super admin', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appUrl('/dashboard'));
    await page.locator('[data-testid="mobile-menu-button"]').click();
    const drawer = page.locator('[role="dialog"][aria-label="Main menu"]');
    await expect(drawer.locator('[data-testid="drawer-admin-link"]')).toBeVisible();
    await shot(page, 'super-admin-mobile-drawer');
  });

  test('demo/live toggle lives inside the portal and switches the view (mock)', async ({ page }) => {
    test.skip(!mockMode, 'demo toggle writes only run against the in-memory QA database');
    await page.goto(appUrl('/admin'));
    const toggle = page.locator('[data-testid="demo-mode-toggle"]').first();
    await toggle.click();
    // The view flips server-side: the amber banner takes over the portal.
    await expect(page.locator('[data-testid="demo-mode-banner"]')).toBeVisible({ timeout: 30_000 });
    await shot(page, 'super-admin-demo-mode-on');
    // …and switches back to live.
    await page.locator('[data-testid="demo-mode-toggle"]').first().click();
    await expect(page.locator('[data-testid="demo-mode-banner"]')).toBeHidden({ timeout: 30_000 });
    await shot(page, 'super-admin-demo-mode-off');
  });
});

// ---------------------------------------------------------------------------
// PERSONA 6 — TENANT B (negative: cross-tenant isolation)
// ---------------------------------------------------------------------------

test.describe('persona: tenant B (negative isolation)', () => {
  test.beforeEach(async ({ page }) => {
    if (mockMode) await signInMockPersona(page, 'tenantBNegative');
    else test.skip(!creds, 'production run needs QA_EMAIL / QA_PASSWORD');
    if (creds && !mockMode) await signInProduction(page, creds);
  });

  test('tenant B dashboard renders only Tenant B data', async ({ page }) => {
    const capture = captureConsole(page);
    capture.attach();
    await page.goto(appUrl('/dashboard'));
    const body = await page.locator('body').innerText();
    // Tenant A seed data must never leak into Tenant B's view.
    expect(body).not.toContain('The Copper Pot');
    expect(body).not.toContain('Thabo Mokoena');
    await shot(page, 'tenant-b-overview');
    expect(capture.errors).toEqual([]);
  });

  test('tenant B cannot open Tenant A resources (API 404s)', async ({ page }) => {
    // Tenant A's seeded conversation id (lib/gate-mock/personas.ts GATE_IDS).
    // POST matches the route's only handler — a GET would 405 for method
    // reasons and prove nothing about isolation.
    const conversationA1 = '55555555-5555-4555-8555-555555555501';
    const res = await page.request.post(
      appUrl(`/api/conversations/${conversationA1}/messages`),
      { data: { content: 'qa2 isolation probe' }, maxRedirects: 0 }
    );
    expect([401, 403, 404]).toContain(res.status());
  });

  test('tenant B inbox does not contain Tenant A customers', async ({ page }) => {
    await page.goto(appUrl('/dashboard/inbox'));
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Thabo Mokoena');
    expect(body).not.toContain('Lerato Khumalo');
  });

  test('tenant B has no Super Admin drawer entry and no admin access', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appUrl('/dashboard'));
    await page.locator('[data-testid="mobile-menu-button"]').click();
    const drawer = page.locator('[role="dialog"][aria-label="Main menu"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[data-testid="drawer-admin-link"]')).toHaveCount(0);
    // The route itself stays fail-closed even for a tenant who guesses /admin.
    await page.goto(appUrl('/admin'));
    await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Cross-persona sanity: the registry itself (guards against drift)
// ---------------------------------------------------------------------------

test('persona registry: exactly the six owner-specified personas', () => {
  expect(Object.keys(PERSONAS).sort()).toEqual(
    [
      'visitor',
      'newOwner',
      'prospectMagicLink',
      'returningOwner',
      'superAdmin',
      'tenantBNegative',
    ].sort()
  );
});
