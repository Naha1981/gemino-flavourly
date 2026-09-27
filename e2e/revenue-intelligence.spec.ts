import { test, expect } from '@playwright/test';

test('public restaurant audit entry point is accessible', async ({ page }) => {
  await page.goto('/audit');
  await expect(page.getByText('Orderly Revenue Diagnostic')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run free audit' })).toBeVisible();
  await expect(page.getByText('Evidence → opportunity → action')).toBeVisible();
});
