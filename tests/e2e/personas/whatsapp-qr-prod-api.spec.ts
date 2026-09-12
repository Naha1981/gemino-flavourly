import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT_DIR, appUrl } from './persona-helpers';

/**
 * Production API-level contract proof. Requires a QA session minted by the
 * existing qa-prod-session helper so no browser/email-code setup is needed.
 */
const SESSION_JWT = process.env.QA_SESSION_JWT;
const DEV_TOKEN = process.env.QA_DEV_BROWSER_TOKEN;

test.describe('production WhatsApp linking — central operator API contract', () => {
  test.skip(!(SESSION_JWT && DEV_TOKEN), 'QA_SESSION_JWT / QA_DEV_BROWSER_TOKEN not provided');

  test('connect, central QR, live status, and QR rotation', async ({ page }) => {
    test.setTimeout(120_000);
    const host = new URL(appUrl('/')).hostname;
    const iat = JSON.parse(Buffer.from(SESSION_JWT!.split('.')[1], 'base64url').toString()).iat;
    await page.context().addCookies([
      { name: '__session', value: SESSION_JWT!, domain: host, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
      { name: '__client_uat', value: String(iat), domain: host, path: '/', httpOnly: false, secure: true, sameSite: 'Lax' },
      { name: '__clerk_db_jwt', value: DEV_TOKEN!, domain: host, path: '/', httpOnly: false, secure: true, sameSite: 'Lax' },
    ]);

    const connectRes = await page.request.post(appUrl('/api/whatsapp/connect'));
    expect(connectRes.status(), await connectRes.text()).toBe(200);
    const connectBody = await connectRes.json();
    expect(connectBody.ok).toBe(true);

    if (!connectBody.isConnected) {
      expect(typeof connectBody.qrCode).toBe('string');
      expect(connectBody.qrCode).toMatch(/^data:image\//);
    }

    const status1 = await page.request.get(appUrl('/api/whatsapp/status'));
    expect(status1.status()).toBe(200);
    const first = await status1.json();
    expect(first.operatorOnline).toBe(true);

    if (!first.isConnected) {
      expect(first.qrCode).toMatch(/^data:image\//);
      await page.waitForTimeout(22_000);
      const status2 = await page.request.get(appUrl('/api/whatsapp/status'));
      expect(status2.status()).toBe(200);
      const second = await status2.json();
      expect(second.qrCode).toMatch(/^data:image\//);
      expect(second.qrCode).not.toBe(first.qrCode);
    }

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(join(ARTIFACT_DIR, 'prod-central-whatsapp-api.json'), JSON.stringify({
      ok: true,
      connect: { status: connectRes.status(), connected: connectBody.isConnected },
      firstStatus: first,
      checkedAt: new Date().toISOString(),
    }, null, 2));
  });
});
