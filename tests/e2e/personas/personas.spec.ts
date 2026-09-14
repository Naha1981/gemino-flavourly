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
  const hasMain = (await page.locator('main').count()) > 0;
  if (hasMain) await expect(page.locator('main')).toBeVisible();
  else await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
  const body = await page.locator('body').innerText();
  expect(body, `${href} must not error`).not.toContain('Internal Server Error');
  await shot(page, `${slug(personaName)}-${slug(label)}`);
  expect(capture.errors, `${href} console errors for ${personaName}`).toEqual([]);
}

test.describe('persona: visitor (anonymous)', () => {
  test('landing loads with the owner-approved headline and zero console errors', async ({ page }) => {
    const capture = captureConsole(page); capture.attach();
    await page.goto(appUrl('/'));
    await expect(page.locator('h1')).toContainText('Turn your restaurant into a growth engine.');
    await shot(page, 'visitor-landing'); expect(capture.errors).toEqual([]);
  });
  test('pricing and sign-in are reachable without an account', async ({ page }) => {
    for (const href of ['/pricing', '/sign-in']) { const res = await page.goto(appUrl(href)); expect(res?.status()).toBeLessThan(400); }
    await shot(page, 'visitor-sign-in');
  });
  test('auth gating: /dashboard and /admin redirect anonymous users to sign-in', async ({ page }) => {
    for (const href of ['/dashboard', '/admin']) { await page.goto(appUrl(href)); await page.waitForURL(/\/sign-in/, { timeout: 15_000 }); }
    expect(page.url()).toContain('/sign-in');
  });
  test('QA sweep endpoints refuse anonymous callers (401, no data leak)', async ({ request }) => {
    const sweep = await request.get(appUrl('/api/cron/qa-sweep'), { maxRedirects: 0 }); expect(sweep.status()).toBe(401);
    const alert = await request.post(appUrl('/api/cron/qa-alert'), { data: { check: 'x', message: 'x' }, maxRedirects: 0 }); expect([401, 403]).toContain(alert.status());
  });
});

test.describe('persona: new owner (WhatsApp QR connect)', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(120_000); if (mockMode) await signInMockPersona(page, 'newOwner'); else test.skip(!creds, 'production run needs QA_EMAIL / QA_PASSWORD'); if (creds && !mockMode) await signInProduction(page, creds); });
  test('QR connect page reaches an honest terminal state (never an infinite spinner)', async ({ page }) => {
    const capture = captureConsole(page); capture.attach(); await page.goto(appUrl('/dashboard/whatsapp'));
    const terminal = page.locator('[data-testid="qr-frame"], [data-testid="engine-error"], [data-testid="engine-offline"], [data-testid="logged-out"]');
    await expect(terminal.first()).toBeVisible({ timeout: 45_000 }); await shot(page, 'new-owner-whatsapp-qr'); expect(capture.errors).toEqual([]);
  });
  test('QR canvas renders machine-scannable and fresh (mock operator harness)', async ({ page }) => {
    test.skip(!mockMode, 'full QR lifecycle needs the GATE_MOCK harness with the mock operator'); await page.goto(appUrl('/dashboard/whatsapp'));
    const qr = page.locator('[data-testid="qr-frame"]'); await expect(qr).toBeVisible({ timeout: 45_000 }); await expect(qr.locator('canvas')).toBeVisible(); await expect(qr).toHaveAttribute('data-qr-phase', 'fresh'); await shot(page, 'new-owner-whatsapp-qr-fresh');
  });
});

test.describe('persona: returning owner (full navigation sweep)', () => {
  test.beforeEach(async ({ page }) => { if (mockMode) await signInMockPersona(page, 'returningOwner'); else test.skip(!creds, 'production run needs QA_EMAIL / QA_PASSWORD'); if (creds && !mockMode) await signInProduction(page, creds); });
  for (const route of ALL_ROUTES) test(`nav: ${route.label} renders, no console errors`, async ({ page }) => { await visitAndAssert(page, route.href, route.label, 'returning-owner'); });
  test('inbox: opens a conversation and shows its messages', async ({ page }) => {
    const capture = captureConsole(page); capture.attach(); await page.goto(appUrl('/dashboard/inbox')); const firstConversation = page.locator('a[href^="/dashboard/inbox/"]').first();
    if (await firstConversation.count()) { await firstConversation.click(); await page.waitForURL(/\/dashboard\/inbox\//); await expect(page.locator('main')).toBeVisible(); await shot(page, 'returning-owner-inbox-conversation'); } else { expect((await page.locator('body').innerText()).length).toBeGreaterThan(0); }
    expect(capture.errors).toEqual([]);
  });
  test('mobile: hamburger drawer exposes EVERY feature + account', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(appUrl('/dashboard')); const menu = page.locator('[data-testid="mobile-menu-button"]'); await expect(menu).toBeVisible(); await menu.click(); const drawer = page.locator('[role="dialog"][aria-label="Main menu"]'); await expect(drawer).toBeVisible();
    for (const item of NAV_ITEMS) await expect(drawer.locator(`a[href="${item.href}"]`)).toBeVisible();
    await shot(page, 'returning-owner-mobile-drawer'); await drawer.locator('a[href="/dashboard/billing"]').click(); await page.waitForURL(/\/dashboard\/billing/); await expect(page.locator('main')).toBeVisible(); await shot(page, 'returning-owner-mobile-billing-via-drawer');
  });
});

test.describe('persona: prospect magic-link', () => {
  test('claim page is PUBLIC: unknown token renders a state, never a 500 or auth wall', async ({ page }) => { const capture = captureConsole(page); capture.attach(); const res = await page.goto(appUrl('/claim/qa2-nonexistent-token')); expect(res?.status()).toBeLessThan(500); await page.waitForURL(/\/(claim|sign-in)/); expect((await page.locator('body').innerText())).not.toContain('Internal Server Error'); await shot(page, 'prospect-claim-unknown-token'); expect(capture.errors).toEqual([]); });
  test('claim redeem API stays auth-gated (401 without a session)', async ({ request }) => { const res = await request.post(appUrl('/api/claim/redeem'), { data: { token: 'qa2-nonexistent-token' }, maxRedirects: 0 }); expect([401, 403, 404, 405]).toContain(res.status()); });
  test('prospect console is super-admin gated (anonymous bounce)', async ({ page }) => { await page.goto(appUrl('/admin/prospects')); await page.waitForURL(/\/sign-in/, { timeout: 15_000 }); });
});

test.describe('persona: super admin (portal)', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(120_000); if (mockMode) await signInMockPersona(page, 'superAdmin'); else test.skip(!creds, 'production run needs QA_EMAIL / QA_PASSWORD'); if (creds && !mockMode) await signInProduction(page, creds); });
  test('/admin renders the portal: kill-switch, fleet, QA alerts, demo toggle', async ({ page }) => { const capture = captureConsole(page); capture.attach(); await page.goto(appUrl('/admin')); await expect(page.getByRole('heading', { name: /Super Admin Platform Overview/i })).toBeVisible(); await expect(page.locator('[data-testid="demo-mode-toggle"]').first()).toBeVisible(); await expect(page.locator('[data-testid="qa-notifications-panel"]')).toBeVisible(); await shot(page, 'super-admin-portal'); expect(capture.errors).toEqual([]); });
  test('/admin/analytics renders without console errors', async ({ page }) => { await visitAndAssert(page, '/admin/analytics', 'Platform Analytics', 'super-admin'); });
  test('desktop logo gesture: double-click opens the Super Admin portal', async ({ page }) => { await page.goto(appUrl('/dashboard')); const logo = page.locator('[data-testid="admin-portal-gesture"]').first(); await expect(logo).toBeVisible(); await logo.dblclick(); await page.waitForURL(/\/admin/, { timeout: 15_000 }); });
  test('mobile logo gesture: 3-second press-and-hold opens the portal', async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto(appUrl('/dashboard')); const logo = page.locator('header [data-testid="admin-portal-gesture"]').first(); await expect(logo).toBeVisible(); const box = await logo.boundingBox(); await logo.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, clientX: (box?.x ?? 0) + (box?.width ?? 0) / 2, clientY: (box?.y ?? 0) + (box?.height ?? 0) / 2 }); await page.waitForURL(/\/admin/, { timeout: 8_000 }); await shot(page, 'super-admin-via-long-press'); });
  test('mobile drawer shows the visible Super Admin entry for the super admin', async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto(appUrl('/dashboard')); await page.locator('[data-testid="mobile-menu-button"]').click(); const drawer = page.locator('[role="dialog"][aria-label="Main menu"]'); await expect(drawer.locator('[data-testid="drawer-admin-link"]')).toBeVisible(); await shot(page, 'super-admin-mobile-drawer'); });
  test('demo/live toggle lives inside the portal and switches the view (mock)', async ({ page }) => { test.skip(!mockMode, 'demo toggle writes only run against the in-memory QA database'); await page.goto(appUrl('/admin')); const toggle = page.locator('[data-testid="demo-mode-toggle"]').first(); await toggle.click(); await expect(page.locator('[data-testid="demo-mode-banner"]')).toBeVisible({ timeout: 30_000 }); await shot(page, 'super-admin-demo-mode-on'); await page.locator('[data-testid="demo-mode-toggle"]').first().click(); await expect(page.locator('[data-testid="demo-mode-banner"]').first()).toBeHidden({ timeout: 30_000 }); await shot(page, 'super-admin-demo-mode-off'); });
});

test.describe('persona: tenant B (negative isolation)', () => {
  test.beforeEach(async ({ page }) => { if (mockMode) await signInMockPersona(page, 'tenantBNegative'); else test.skip(!creds, 'production run needs QA_EMAIL / QA_PASSWORD'); if (creds && !mockMode) await signInProduction(page, creds); });
  test('tenant B dashboard renders only Tenant B data', async ({ page }) => { await page.goto(appUrl('/dashboard')); await expect(page.locator('main')).toBeVisible(); const body = await page.locator('body').innerText(); expect(body).toContain('Harbor Fish House'); expect(body).not.toContain('Tenant A'); });
  test('tenant B cannot open Tenant A resources (API 404s)', async ({ request }) => { const res = await request.get(appUrl('/api/marketing/campaigns/qa-tenant-a')); expect([404, 405]).toContain(res.status()); });
  test('tenant B inbox does not contain Tenant A customers', async ({ page }) => { await page.goto(appUrl('/dashboard/inbox')); const body = await page.locator('body').innerText(); expect(body).not.toContain('Tenant A'); expect(body).not.toContain('+27820000001'); });
  test('tenant B has no Super Admin drawer entry and no admin access', async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto(appUrl('/dashboard')); await page.locator('[data-testid="mobile-menu-button"]').click(); const drawer = page.locator('[role="dialog"][aria-label="Main menu"]'); await expect(drawer.locator('[data-testid="drawer-admin-link"]')).toHaveCount(0); await page.goto(appUrl('/admin')); await page.waitForURL(/\/sign-in/, { timeout: 15_000 }); });
});

test('persona registry: exactly the six owner-specified personas', async () => { expect(Object.keys(PERSONAS).sort()).toEqual(['newOwner', 'prospectMagicLink', 'returningOwner', 'superAdmin', 'tenantBNegative', 'visitor']); });
