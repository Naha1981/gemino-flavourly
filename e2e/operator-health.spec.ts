import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OPERATOR_URL = process.env.OPERATOR_URL || 'http://localhost:3001';

test.describe('Gemino Platform Health & Endpoints', () => {
  test('Operator /health endpoint returns OK status 200', async ({ request }) => {
    const response = await request.get(`${OPERATOR_URL}/health`);
    expect(response.ok()).toBeTruthy();
    expect(await response.text()).toBe('OK');
  });

  test('Main app root landing page renders', async ({ page }) => {
    await page.goto(BASE_URL);
    // Real hero headline — was previously asserting a stale placeholder
    // ("Autonomous WhatsApp Operations") that never matched the actual
    // landing page copy, so this test always failed regardless of app health.
    await expect(page.locator('h1')).toContainText('Every WhatsApp message answered');
  });
});
