import { test, expect } from '@playwright/test';

test.describe('Gemino Platform End-to-End Test Suite', () => {
  // Test 1: Landing page loads, and double-clicking the "G" logo redirects to /admin
  test('Test 1: Landing page loads and double-clicking the "G" logo redirects to /admin', async ({ page }) => {
    await page.goto('/');
    
    // Check hero headline
    await expect(page.locator('h1')).toContainText('Every WhatsApp message answered');
    
    // Find the logo button and double click
    const logoButton = page.locator('button[title*="Gemino AI"]');
    await expect(logoButton).toBeVisible();
    await logoButton.dblclick();
    
    // Should navigate to /admin (or /sign-in if unauthenticated server check kicks in)
    await page.waitForURL(/\/(admin|sign-in)/);
    expect(page.url()).toMatch(/\/(admin|sign-in)/);
  });

  // Test 2: The /sign-in and /sign-up forms render without 500 errors
  test('Test 2: The /sign-in and /sign-up forms render without 500 errors', async ({ page }) => {
    // Check sign-in page
    const signInResponse = await page.goto('/sign-in');
    expect(signInResponse?.status()).toBeLessThan(400);
    await expect(page.locator('.cl-signIn-root, .cl-rootBox, form, input')).toBeVisible({ timeout: 15000 });

    // Check sign-up page
    const signUpResponse = await page.goto('/sign-up');
    expect(signUpResponse?.status()).toBeLessThan(400);
    await expect(page.locator('.cl-signUp-root, .cl-rootBox, form, input')).toBeVisible({ timeout: 15000 });
  });

  // Test 3: The middleware correctly intercepts /dashboard and redirects unauthenticated users to /sign-in
  test('Test 3: Middleware intercepts /dashboard and redirects unauthenticated users to /sign-in', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Expect redirection to sign-in
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toContain('/sign-in');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
    await expect(page.locator('body')).not.toContainText('500');
  });
});
