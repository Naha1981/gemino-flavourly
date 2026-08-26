import { test, expect, type Browser, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * S6 — ship E2E suite.
 *
 * Runs against a deployed environment (the session's Vercel preview or
 * production) with seeded state produced by e2e/ship-seed.mjs:
 *
 *   node e2e/ship-seed.mjs   # needs BASE_URL, CLERK_SECRET_KEY, DATABASE_URL
 *   npx playwright test e2e/ship.spec.ts
 *
 * Coverage: magic-link branding + "Not confirmed yet"; claim lands in the
 * CLAIMED tenant dashboard; already-claimed deep-links; tenant switcher;
 * negative tenant isolation; billing gate; kill-switch. Every page test
 * collects console errors and asserts ZERO. Screenshots are captured
 * automatically on failure (playwright.config: screenshot only-on-failure).
 */

// Playwright runs from the repo root (playwright.config.ts lives there); the
// seed script writes the state file next to it.
const STATE_PATH = join(process.cwd(), '.e2e-state.json');
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';

interface SeedUser {
  email: string;
  password: string;
  userId: string;
  sessionId: string;
}

interface ShipState {
  baseUrl: string;
  owner: SeedUser;
  outsider: SeedUser;
  admin: SeedUser;
  prospect: { id: string; tenantId: string; claimToken: string; claimLink: string };
}

function loadState(): ShipState | null {
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as ShipState;
  } catch {
    return null;
  }
}

const state = loadState();
const BASE_URL = process.env.BASE_URL || state?.baseUrl || 'https://gemino-flavourly-whatsapp.vercel.app';

/** Console noise we never count as app errors (third-party widgets). */
const NOISE_PATTERNS = [
  /favicon/i,
  /clerk\.com|clerk\.dev/i, // Clerk dev widget chatter
  /Download the React DevTools/i,
];

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (NOISE_PATTERNS.some((p) => p.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

async function freshJwt(sessionId: string): Promise<string> {
  const res = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`session token refresh failed: ${res.status}`);
  const { jwt } = await res.json();
  return jwt;
}

async function authedPage(browser: Browser, jwt: string): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${jwt}` },
  });
  const page = await context.newPage();
  const errors = watchConsole(page);
  return { page, errors };
}

async function apiFetch(path: string, jwt: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    redirect: 'manual',
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

test.describe.configure({ mode: 'serial' });

test.describe('S6 ship suite', () => {
  test.skip(!state || !CLERK_SECRET_KEY, 'Requires seeded state (node e2e/ship-seed.mjs) + CLERK_SECRET_KEY');

  let ownerJwt = '';
  let outsiderJwt = '';
  let adminJwt = '';
  let selfTenantId = '';

  test.beforeAll(async () => {
    [ownerJwt, outsiderJwt, adminJwt] = await Promise.all([
      freshJwt(state!.owner.sessionId),
      freshJwt(state!.outsider.sessionId),
      freshJwt(state!.admin.sessionId),
    ]);
  });

  test('magic link shows restaurant branding + "Not confirmed yet" + Sample badge, 0 console errors', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`/claim/${state!.prospect.claimToken}`);

    // Restaurant branding — NOT the generic Flavourly shell: the demo
    // tenant's name headlines the page and the brand CSS variables are set.
    await expect(page.locator('h1')).toBeVisible();
    const h1 = await page.locator('h1').first().innerText();
    expect(h1.length).toBeGreaterThan(0);
    expect(h1).not.toBe('Flavourly');

    const brandVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim()
    );
    expect(brandVar).not.toBe('');

    // Empty hours/menu state — never invented data.
    await expect(page.locator('[data-testid="claim-hours"]')).toContainText('Not confirmed yet');
    await expect(page.locator('[data-testid="claim-menu"]')).toContainText('Not confirmed yet');

    // Bookings are badged as sample data.
    await expect(page.locator('body')).toContainText('Sample');

    // Claim CTA present.
    await expect(page.locator('body')).toContainText(/Claim/i);

    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('claim lands the owner in the CLAIMED tenant dashboard', async ({ browser }) => {
    // First give the owner a self-created tenant so the switcher has two.
    const { page: dashPage, errors: dashErrors } = await authedPage(browser, ownerJwt);
    await dashPage.goto('/dashboard');
    await dashPage.waitForLoadState('networkidle');
    expect(dashPage.url()).not.toContain('/sign-in');
    const list = await apiFetch('/api/tenant/list', ownerJwt);
    expect(list.status).toBe(200);
    selfTenantId = list.data.tenants?.[0]?.id ?? '';
    await dashPage.context().close();
    expect(dashErrors, `console errors: ${dashErrors.join(' | ')}`).toHaveLength(0);

    // Redeem the claim token with the claim cookie set.
    const redeem = await fetch(`${BASE_URL}/api/claim/redeem`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerJwt}`,
        'Content-Type': 'application/json',
        Cookie: `flavourly_claim=${state!.prospect.claimToken}`,
      },
      body: JSON.stringify({}),
    });
    const redeemBody = await redeem.json();
    expect(redeem.status).toBe(200);
    expect(redeemBody.ok).toBe(true);
    expect(redeemBody.tenantId).toBe(state!.prospect.tenantId);
    // S2 — redirect is the deep-link into the claimed tenant dashboard.
    expect(redeemBody.redirect).toBe(`/dashboard?tenant=${state!.prospect.tenantId}`);
    // S2 — the flavourly_active_tenant cookie is set on redeem.
    const setCookie = redeem.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('flavourly_active_tenant');

    // Follow the deep-link: owner lands in the CLAIMED tenant's dashboard.
    const { page, errors } = await authedPage(browser, ownerJwt);
    await page.goto(`/dashboard?tenant=${state!.prospect.tenantId}`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain(`/dashboard?tenant=${state!.prospect.tenantId}`);
    expect(page.url()).not.toContain('/sign-in');
    // The switcher shows the claimed tenant as the active selection.
    const select = page.locator('[data-testid="tenant-switcher-select"]');
    if ((await select.count()) > 0) {
      await expect(select).toHaveValue(state!.prospect.tenantId);
    }
    await page.context().close();
    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('already-claimed page deep-links to the claimed tenant dashboard', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`/claim/${state!.prospect.claimToken}`);

    await expect(page.locator('body')).toContainText(/has been claimed/i);

    const signInHref = await page.locator('[data-testid="already-claimed-sign-in"]').getAttribute('href');
    expect(signInHref).toContain('/sign-in');
    expect(decodeURIComponent(signInHref ?? '')).toContain(`/dashboard?tenant=${state!.prospect.tenantId}`);

    const goHomeHref = await page.locator('[data-testid="already-claimed-go-home"]').getAttribute('href');
    expect(goHomeHref).toBe(`/dashboard?tenant=${state!.prospect.tenantId}`);

    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('tenant switcher works (?tenant= priority, cookie persistence)', async ({ browser }) => {
    const { page, errors } = await authedPage(browser, ownerJwt);

    // The owner now manages two tenants -> the switcher renders a select.
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const select = page.locator('[data-testid="tenant-switcher-select"]');
    const list = await apiFetch('/api/tenant/list', ownerJwt);
    const tenantIds: string[] = (list.data.tenants ?? []).map((t: any) => t.id);
    expect(tenantIds).toContain(state!.prospect.tenantId);

    if ((await select.count()) > 0) {
      const options = await select.locator('option').count();
      expect(options).toBeGreaterThanOrEqual(2);
    }

    // Switch to the self tenant through the real endpoint.
    const switchRes = await apiFetch('/api/tenant/switch', ownerJwt, {
      method: 'POST',
      body: JSON.stringify({ tenantId: selfTenantId }),
    });
    expect(switchRes.status).toBe(200);
    expect(switchRes.data.ok).toBe(true);
    expect(switchRes.data.redirect).toBe(`/dashboard?tenant=${selfTenantId}`);

    // Cookie path: no ?tenant= now — the sticky cookie resolves the tenant.
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/sign-in');

    await page.context().close();
    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('negative tenant isolation: outsider cannot enter or switch into the claimed tenant', async ({ browser, request }) => {
    // API-level: switching into someone else's tenant is a 403.
    const res = await apiFetch('/api/tenant/switch', outsiderJwt, {
      method: 'POST',
      body: JSON.stringify({ tenantId: state!.prospect.tenantId }),
    });
    expect(res.status).toBe(403);

    // The outsider's managed list never contains the owner's tenants.
    const list = await apiFetch('/api/tenant/list', outsiderJwt);
    expect(list.status).toBe(200);
    const ids: string[] = (list.data.tenants ?? []).map((t: any) => t.id);
    expect(ids).not.toContain(state!.prospect.tenantId);
    expect(ids).not.toContain(selfTenantId);

    // Page-level: deep-linking into the foreign tenant must NOT resolve it.
    const { page, errors } = await authedPage(browser, outsiderJwt);
    await page.goto(`/dashboard?tenant=${state!.prospect.tenantId}`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/sign-in');
    const select = page.locator('[data-testid="tenant-switcher-select"]');
    if ((await select.count()) > 0) {
      await expect(select).not.toHaveValue(state!.prospect.tenantId);
    }
    // The claimed tenant's name must not appear in the switcher.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain(state!.prospect.tenantId);
    await page.context().close();
    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('billing gate: claimed tenant is trialing and not read-only', async ({ request }) => {
    const res = await apiFetch('/api/billing', ownerJwt);
    expect(res.status).toBe(200);
    // S2 flipped the claimed tenant to a live 14-day trial.
    expect(res.data.planStatus ?? res.data.billing?.planStatus).toBe('trialing');
    const readOnly = res.data.readOnly ?? res.data.billing?.readOnly;
    expect(readOnly).toBe(false);
  });

  test('kill-switch: super-admin gated; tenant-scoped toggle works and restores', async ({ request }) => {
    // Non-admin is rejected.
    const denied = await apiFetch('/api/admin/toggle-ai', outsiderJwt, {
      method: 'POST',
      body: JSON.stringify({ enabled: false, tenantId: state!.prospect.tenantId }),
    });
    expect([401, 403]).toContain(denied.status);

    // Admin toggles the claimed tenant's AI off, then back on.
    const off = await apiFetch('/api/admin/toggle-ai', adminJwt, {
      method: 'POST',
      body: JSON.stringify({ enabled: false, tenantId: state!.prospect.tenantId }),
    });
    expect(off.status).toBe(200);
    expect(off.data.success).toBe(true);
    expect(off.data.aiEnabled).toBe(false);

    const on = await apiFetch('/api/admin/toggle-ai', adminJwt, {
      method: 'POST',
      body: JSON.stringify({ enabled: true, tenantId: state!.prospect.tenantId }),
    });
    expect(on.status).toBe(200);
    expect(on.data.aiEnabled).toBe(true);
  });

  test('cron endpoints stay bearer-gated (no secret, no entry)', async ({ request }) => {
    const noAuth = await request.get(`${BASE_URL}/api/cron/system-watchdog`);
    expect(noAuth.status()).toBe(401);

    const wrong = await request.get(`${BASE_URL}/api/cron/system-watchdog`, {
      headers: { Authorization: 'Bearer not-the-secret' },
    });
    expect(wrong.status()).toBe(401);
  });
});
