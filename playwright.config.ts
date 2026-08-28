import { defineConfig, devices } from '@playwright/test';

// GATE_BASE_URL: used by the GATE V4/V5 harness (e2e/gate-v4-v5.spec.ts) to
// point the API-level suite at the local gate dev server. BASE_URL and the
// Vercel default are unchanged for all existing suites.
const BASE_URL = process.env.GATE_BASE_URL || process.env.BASE_URL || 'https://gemino-flavourly-whatsapp.vercel.app';

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
