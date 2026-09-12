import { test, expect } from '@playwright/test';
import {
  isMockMode,
  productionCredentials,
  signInProduction,
  appUrl,
  ARTIFACT_DIR,
} from './persona-helpers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Production proof for the central NahaLabs WhatsApp Operator contract. */
test.describe('production WhatsApp linking — central operator', () => {
  const creds = productionCredentials();
  test.skip(isMockMode(), 'production-only test');
  test.skip(!creds, 'QA_EMAIL / QA_PASSWORD not provided');

  test('connect kick reaches central operator and QR/status stay authoritative', async ({ page }) => {
    test.setTimeout(180_000);
    expect(await signInProduction(page, creds!)).toBe(true);

    await page.goto(appUrl('/dashboard/whatsapp'), { waitUntil: 'domcontentloaded' });

    const connect = await page.waitForResponse(
      (response) => response.url().includes('/api/whatsapp/connect') && response.request().method() === 'POST',
      { timeout: 75_000 }
    ).catch(() => null);
    expect(connect, 'Gemino did not kick the central Operator within 75s').toBeTruthy();
    expect(connect!.status(), await connect!.text()).toBe(200);

    const connectBody = await connect!.json();
    expect(connectBody.ok).toBe(true);

    const status = page.locator('[data-testid="qr-frame"]');
    const connected = page.getByText('WhatsApp Connected');

    await expect(status.or(connected)).toBeVisible({ timeout: 45_000 });

    if (await connected.isVisible().catch(() => false)) {
      expect(connectBody.isConnected).toBe(true);
      return;
    }

    const image = status.locator('img').first();
    await expect(image, 'central Operator QR should be rendered directly as an image').toHaveAttribute('src', /^data:image\//);

    const firstSrc = await image.getAttribute('src');
    expect(firstSrc).toBeTruthy();

    const statusResponses: unknown[] = [];
    const handler = async (response: import('@playwright/test').Response) => {
      if (response.url().includes('/api/whatsapp/status') && response.ok()) {
        statusResponses.push(await response.json().catch(() => null));
      }
    };
    page.on('response', handler);

    await expect.poll(() => statusResponses.some((entry: any) => entry?.operatorOnline === true && typeof entry?.qrCode === 'string')).toBe(true);

    await page.waitForTimeout(22_000);
    const secondSrc = await image.getAttribute('src');
    expect(secondSrc).toBeTruthy();
    expect(secondSrc).not.toBe(firstSrc);

    page.off('response', handler);
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(join(ARTIFACT_DIR, 'prod-central-whatsapp.json'), JSON.stringify({
      ok: true,
      connectStatus: connect.status(),
      firstQrDataUrl: firstSrc?.slice(0, 32),
      secondQrDataUrl: secondSrc?.slice(0, 32),
      rotated: secondSrc !== firstSrc,
      statusSnapshots: statusResponses,
    }, null, 2));
  });
});
