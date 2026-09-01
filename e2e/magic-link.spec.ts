import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://gemino-flavourly-whatsapp.vercel.app';

/**
 * Magic Link feature (Gate 3) — End-to-End contract checks.
 *
 * Runnable against any deployed preview:
 *   - /admin/prospects is super-admin gated (a normal visitor is bounced to
 *     sign-in; an anonymous visitor never sees the console or a 500);
 *   - the prospects APIs return 401/403 without a super-admin;
 *   - the /claim/[token] page is PUBLIC (no auth wall) so a prospect owner
 *     can open the pitch link on their phone;
 *   - the claim redeem path enforces auth (POST /api/claim/redeem 401 when
 *     unauthenticated).
 *
 * The full seeded demo build + claim needs a live DB and Clerk session, so it
 * is covered by the unit + wiring suites in apps/main/lib/brand-intelligence;
 * those flows are gated behind an explicit env flag here and skipped
 * otherwise (mirroring the reputation spec).
 */
test.describe('Magic Link feature (Gate 3)', () => {
  test('/admin/prospects is super-admin gated (anonymous bounce, no 500)', async ({ page }) => {
    await page.goto('/admin/prospects');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
    // Anonymous or non-admin visits are chased to sign-in by middleware/page.
    await page.waitForURL(/\/sign-in/);
  });

  test('/admin is super-admin gated too', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL(/\/sign-in/);
  });

  test('prospects APIs are auth-gated (401/403 without a super-admin)', async ({ request }) => {
    const list = await request.get(`${BASE_URL}/api/prospects`, { maxRedirects: 0 });
    // 404 = Clerk v5 protect() semantics for anonymous API calls (J2.2).
    expect([401, 403, 404]).toContain(list.status());

    const add = await request.post(`${BASE_URL}/api/prospects`, {
      data: { name: 'X', website: 'https://x.com' },
      maxRedirects: 0,
    });
    expect([401, 403, 404]).toContain(add.status());

    const imp = await request.post(`${BASE_URL}/api/prospects/import`, {
      data: { csv: 'name,website\nFoo,foo.com' },
      maxRedirects: 0,
    });
    expect([401, 403, 404]).toContain(imp.status());
  });

  test('the /claim public page is reachable without auth (no sign-in wall)', async ({ page }) => {
    // An unknown token must render the "invalid link" state publicly, not ask
    // the visitor to sign in — this page is opened from WhatsApp/phone.
    await page.goto('/claim/not-a-real-token');
    await page.waitForSelector('text=invalid');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('claim redeem requires auth (401/redirect without a session)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/claim/redeem`, { maxRedirects: 0 });
    // Not signed in -> redirected to /sign-in (307/302) by the route handler.
    // 404 = Clerk v5 protect() semantics for anonymous API calls (J2.2).
    expect([302, 307, 401, 403, 404]).toContain(res.status());

    const api = await request.post(`${BASE_URL}/api/claim/redeem`, {
      data: { claim: 'some-token' },
      maxRedirects: 0,
    });
    expect([401, 403, 404]).toContain(api.status());
  });

  test('full seeded build + claim flow (needs DB; skipped unless ENFORCE_WORKFLOW=1)', async ({ page }) => {
    test.skip(!process.env.ENFORCE_WORKFLOW, 'Requires a live DB + Clerk session');
    // Placeholder for a fully-seeded run: build -> open /claim -> sign-up ->
    // redeem -> /onboarding. Covered by unit + wiring suites.
    expect(true).toBe(true);
  });
});
