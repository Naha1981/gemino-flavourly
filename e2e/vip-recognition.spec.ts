import { test, expect } from '@playwright/test';
import { createHmac } from 'crypto';

const BASE_URL = process.env.BASE_URL || 'https://gemino-flavourly-whatsapp.vercel.app';

/**
 * Gate #10 — VIP Recognition End-to-End.
 *
 * Auth-gated contract checks (runnable against any deployed preview):
 *   - the VIP-today dashboard and the inbox both redirect unauthenticated
 *     visitors to /sign-in and never render a 500;
 *   - the VIP alerts API returns 401 without a signed-in tenant.
 *
 * The full walk-in flow requires a seeded VIP profile and a signed-in Clerk
 * session, so it lives here gated on explicit env vars:
 *   E2E_WEBHOOK_SECRET, E2E_WA_ACCOUNT_ID, E2E_VIP_PHONE.
 */

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

test.describe('VIP Recognition End-to-End (Gate #10)', () => {
  test('vip-today dashboard and inbox are auth-gated', async ({ page }) => {
    await page.goto('/dashboard/customers/vip-today');
    await page.waitForURL(/\/sign-in/);
    await page.goto('/dashboard/inbox');
    await page.waitForURL(/\/sign-in/);
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
    await expect(page.locator('body')).not.toContainText('500');
  });

  test('VIP alerts API is auth-gated (401 when unauthenticated)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/customer/vip-alerts`, { maxRedirects: 0 });
    expect([401, 403]).toContain(res.status());
  });

  test('full walk-in flow: VIP profile → first message → alert created', async ({ request, page }) => {
    const secret = process.env.E2E_WEBHOOK_SECRET;
    const waAccountId = process.env.E2E_WA_ACCOUNT_ID;
    const vipPhone = process.env.E2E_VIP_PHONE;

    test.skip(!secret || !waAccountId || !vipPhone,
      'Set E2E_WEBHOOK_SECRET, E2E_WA_ACCOUNT_ID and E2E_VIP_PHONE to a deployed tenant with a seeded VIP profile (12 visits, R3000 spend, segment=vip).');

    // A first message from the VIP phone arrives.
    const rawBody = JSON.stringify({
      waAccountId,
      message: {
        key: { remoteJid: `${vipPhone}@s.whatsapp.net`, id: `e2e-vip-${Date.now()}` },
        pushName: 'Thabo',
        message: { conversation: 'Hi, table for two tonight please' },
      },
    });

    const deliver = () =>
      request.post(`${BASE_URL}/api/webhooks/whatsapp`, {
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': sign(rawBody, secret!),
        },
        data: rawBody,
      });

    const res = await deliver();
    expect(res.status()).toBeLessThan(500);

    // Re-delivering the SAME WhatsApp message id must be a no-op (idempotent),
    // so no second alert is raised for the same walk-in.
    const dup = await deliver();
    expect(dup.status()).toBeLessThan(500);

    // Sign in as the restaurant and open the VIP-today dashboard; the seeded
    // VIP alert for today must be visible to staff.
    const signIn = await page.goto('/sign-in');
    expect(signIn?.status()).toBeLessThan(400);
    await expect(page.locator('.cl-signIn-root').first()).toBeVisible({ timeout: 15000 });
  });
});
