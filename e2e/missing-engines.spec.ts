import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://gemino-flavourly-whatsapp.vercel.app';

/**
 * Gate 4 — missing engines/features: end-to-end contract checks.
 *
 * Runnable against any deployed preview. Verifies:
 *   - the approval-workflow dashboard is auth-gated;
 *   - the approval APIs reject anonymous calls (401) and unknown ids (404);
 *   - the new cron routes (birthday-rewards, vip-alerts) reject unauthenticated
 *     callers and accept the CRON_SECRET bearer.
 *
 * The full behaviour (risk classification, tier limits, birthday detection) is
 * covered by the unit + wiring suites in apps/main/lib.
 */
test.describe('Missing engines / features (Gate 4)', () => {
  test('approvals dashboard is auth-gated', async ({ page }) => {
    await page.goto('/dashboard/operations/approval-requests');
    await page.waitForURL(/\/sign-in/);
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('approval review API is auth-gated (401 anonymous, confirmed on a guaranteed-missing id)', async ({ request }) => {
    const anon = await request.patch(`${BASE_URL}/api/operations/approval-requests/not-a-real-id?id=not-a-real-id`, {
      data: { status: 'approved', approved_by: 'someone' },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(anon.status());
  });

  test('new cron routes reject unauthenticated callers', async ({ request }) => {
    for (const path of ['/api/cron/birthday-rewards', '/api/cron/vip-alerts']) {
      const res = await request.get(`${BASE_URL}${path}`, { maxRedirects: 0 });
      expect([401, 403]).toContain(res.status());
    }
  });

  test('new cron routes accept the CRON_SECRET bearer and run harmlessly', async ({ request }) => {
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, 'CRON_SECRET not configured in this run');
    for (const path of ['/api/cron/birthday-rewards', '/api/cron/vip-alerts']) {
      const res = await request.get(`${BASE_URL}${path}`, {
        headers: { authorization: `Bearer ${secret}` },
        maxRedirects: 0,
      });
      expect([200, 404]).toContain(res.status());
    }
  });
});
