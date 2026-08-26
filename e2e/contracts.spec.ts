import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://gemino-flavourly-whatsapp.vercel.app';

/**
 * Anonymous API/page contract checks — no credentials required, safe to run
 * from CI against any deployed environment (preview or production). Covers
 * the auth gates that protect the ship surface:
 *
 *   - every /api/cron/* route (including the S5 system watchdog) rejects
 *     missing/wrong bearer tokens;
 *   - /api/admin/sync-crons refuses anonymous callers;
 *   - /api/tenant/switch + /api/tenant/list require a session;
 *   - /claim/[token] stays public; /admin/prospects stays gated.
 */

test.describe('anonymous contract gates', () => {
  test('cron routes reject missing and wrong bearer tokens (incl. system watchdog)', async ({ request }) => {
    for (const route of ['/api/cron/system-watchdog', '/api/cron/process-prospects', '/api/cron/outbox']) {
      const noAuth = await request.get(`${BASE_URL}${route}`, { maxRedirects: 0 });
      expect(noAuth.status(), `${route} without token`).toBe(401);

      const wrong = await request.get(`${BASE_URL}${route}`, {
        headers: { Authorization: 'Bearer definitely-not-the-secret' },
        maxRedirects: 0,
      });
      expect(wrong.status(), `${route} with wrong token`).toBe(401);
    }
  });

  test('/api/admin/sync-crons is gated for anonymous callers', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/sync-crons`, { maxRedirects: 0 });
    // Clerk middleware redirects anonymous API callers or the route 401/403s.
    expect([302, 307, 401, 403]).toContain(res.status());
  });

  test('/api/tenant/switch requires a session and a valid body', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/tenant/switch`, {
      data: { tenantId: '00000000-0000-0000-0000-000000000000' },
      maxRedirects: 0,
    });
    expect([302, 307, 401, 403]).toContain(res.status());
  });

  test('/api/tenant/list requires a session', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/tenant/list`, { maxRedirects: 0 });
    expect([302, 307, 401]).toContain(res.status());
  });

  test('/claim/[token] is public; unknown token renders the invalid state', async ({ page }) => {
    await page.goto('/claim/not-a-real-token');
    await expect(page.locator('body')).toContainText(/invalid/i);
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('/admin/prospects bounces anonymous visitors to sign-in', async ({ page }) => {
    await page.goto('/admin/prospects');
    await page.waitForURL(/\/sign-in/);
  });
});
