import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://gemino-flavourly-whatsapp.vercel.app';

/**
 * Gate #15-#18 — Market Intelligence End-to-End.
 *
 * Auth-gated contract checks (runnable against any deployed preview):
 *   - the market dashboards redirect unauthenticated visitors to /sign-in
 *     and never render a 500;
 *   - the market APIs return 401 without a signed-in tenant;
 *   - the tracking cron rejects unauthenticated callers.
 *
 * The full workflows (discovery -> tracking -> alerts -> positioning) need
 * seeded competitors, live Google credentials and a signed-in tenant, so
 * they are covered by the unit/integration suites in
 * apps/main/lib/market/ and gated here on explicit env vars.
 */
test.describe('Market Intelligence (Gates #15-#18)', () => {
  test('market dashboards are auth-gated', async ({ page }) => {
    for (const path of [
      '/dashboard/market/competitors',
      '/dashboard/market/opportunities',
      '/dashboard/market/positioning',
    ]) {
      await page.goto(path);
      await page.waitForURL(/\/sign-in/);
      await expect(page.locator('body')).not.toContainText('Internal Server Error');
    }
  });

  test('market APIs are auth-gated (401 when unauthenticated)', async ({ request }) => {
    for (const path of [
      '/api/market/competitors',
      '/api/market/opportunities',
      '/api/market/alerts',
      '/api/market/positioning',
    ]) {
      const res = await request.get(`${BASE_URL}${path}`, { maxRedirects: 0 });
      expect([401, 403]).toContain(res.status());
    }

    const discover = await request.post(`${BASE_URL}/api/market/competitors/discover`, {
      data: { radius_km: 5 },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(discover.status());

    const mark = await request.patch(`${BASE_URL}/api/market/opportunities/some-id`, {
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(mark.status());
  });

  test('tracking cron rejects unauthenticated callers', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/cron/track-competitors`, { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    const body = await res.json().catch(() => ({}));
    expect(body).not.toHaveProperty('snapshotsSaved');
  });

  test('authenticated cron run completes harmlessly when configured', async ({ request }) => {
    const secret = process.env.E2E_CRON_SECRET;
    test.skip(!secret, 'Set E2E_CRON_SECRET to exercise the guarded cron boundary.');

    const res = await request.get(`${BASE_URL}/api/cron/track-competitors`, {
      headers: { Authorization: `Bearer ${secret}` },
      maxRedirects: 0,
    });
    expect(res.status()).not.toBe(401);
    expect(res.status()).not.toBe(403);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('ok', true);
  });
});
