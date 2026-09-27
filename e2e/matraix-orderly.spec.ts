import { test, expect } from '@playwright/test';

test.describe('Orderly synthetic persona smoke — report mode', () => {
  test('anonymous visitor reaches the Orderly audit funnel', async ({ page }) => {
    await page.goto('/audit');
    await expect(page).toHaveURL(/\/audit/);
    await expect(page.locator('body')).toContainText(/Orderly Revenue Diagnostic/i);
  });

  test('dashboard surfaces are auth gated', async ({ page }) => {
    await page.goto('/dashboard/intelligence');
    await page.waitForURL(/\/sign-in/);
  });

  test('public menu remains available without auth', async ({ page }) => {
    await page.goto('/m/demo-not-found');
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});
