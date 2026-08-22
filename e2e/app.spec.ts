import { test, expect } from '@playwright/test';

test.describe('Flavourly platform smoke', () => {
  test('landing loads and logo double-click reaches admin or sign-in', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Every message answered');
    const logoButton = page.locator('button[title*="Flavourly"]');
    await expect(logoButton).toBeVisible();
    await logoButton.dblclick();
    await page.waitForURL(/\/(admin|sign-in|dashboard)/);
  });

  test('sign-in renders without 500', async ({ page }) => {
    const signInResponse = await page.goto('/sign-in');
    expect(signInResponse?.status()).toBeLessThan(400);
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('public menu is not behind auth', async ({ page }) => {
    const res = await page.goto('/m/the-marula-room');
    expect(res?.status()).toBeLessThan(500);
  });

  test('dashboard is reachable in demo (or protected in clerk mode)', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/(dashboard|sign-in)/);
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });
});
