import { test, expect } from '@playwright/test';
import { appUrl, isMockMode } from './persona-helpers';

/**
 * GATE QA-2 — the alert pipeline, failing-first.
 *
 * Owner spec: "inject fake failure → assert email mock + notification row
 * created". Written BEFORE the pipeline existed (red), then made green by
 * lib/qa/alerts.ts + /api/cron/qa-alert + the /admin panel — the red run
 * is preserved in the gate report evidence.
 *
 * The email leg runs in MOCK transport on the gate dev server
 * (QA_ALERT_EMAIL_TRANSPORT=mock — the harness env), so the assertion
 * "emailStatus=mock-sent" proves the Resend call path without network or
 * secrets. The notification row is asserted where it renders: the Super
 * Admin portal (unread badge + row) — the same surface the owner reads.
 */

const mockMode = isMockMode();
const CRON_SECRET = process.env.CRON_SECRET ?? '';

test.describe('QA-2 alert pipeline (inject fake failure)', () => {
  test.skip(!mockMode || !CRON_SECRET, 'needs the GATE_MOCK harness with CRON_SECRET exported');

  const CHECK = 'qa2-e2e/injected-failure';
  const MESSAGE = 'Injected fake failure for the failing-first pipeline test.';

  test('POST /api/cron/qa-alert: row created + email mock dispatched', async ({ request }) => {
    const res = await request.post(appUrl('/api/cron/qa-alert'), {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      data: { severity: 'critical', check: CHECK, message: MESSAGE, reportUrl: appUrl('/') },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.dispatched === true || body.reason === 'deduped').toBe(true);
    if (body.dispatched) expect(body.emailStatus).toBe('mock-sent');
  });

  test('the alert renders in the Super Admin portal with the unread badge', async ({ page }) => {
    const host = new URL(appUrl('/')).hostname;
    await page.context().addCookies([
      { name: '__gate_user', value: 'user_gate_superadmin', domain: host, path: '/', sameSite: 'Lax' },
    ]);
    await page.goto(appUrl('/admin'));
    await expect(page.locator('[data-testid="qa-notifications-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="qa-unread-badge"]')).toBeVisible();
    const row = page.locator('[data-testid="qa-notification-row"]', { hasText: CHECK }).first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-unread', 'true');
    await expect(row).toHaveAttribute('data-severity', 'critical');
  });

  test('dedupe: the same check does NOT re-alert within 6 hours', async ({ request }) => {
    const res = await request.post(appUrl('/api/cron/qa-alert'), {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      data: { severity: 'critical', check: CHECK, message: `${MESSAGE} (repeat)` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.dispatched).toBe(false);
    expect(body.reason).toBe('deduped');
    expect(body.dedupedUntil).toBeTruthy();
  });

  test('validation: missing check/message is a 400, not a silent alert', async ({ request }) => {
    const res = await request.post(appUrl('/api/cron/qa-alert'), {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      data: { severity: 'critical' },
    });
    expect(res.status()).toBe(400);
  });

  test('auth: a wrong bearer secret is rejected with 401', async ({ request }) => {
    const res = await request.post(appUrl('/api/cron/qa-alert'), {
      headers: { Authorization: 'Bearer definitely-not-the-secret' },
      data: { severity: 'critical', check: 'x', message: 'x' },
    });
    expect(res.status()).toBe(401);
  });

  test('mark-all-read clears the unread badge through the protected endpoint', async ({ page, request }) => {
    const uniqueCheck = `qa2-e2e/mark-read-${Date.now()}`;
    const alert = await request.post(appUrl('/api/cron/qa-alert'), {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      data: { severity: 'critical', check: uniqueCheck, message: 'Injected mark-read test alert.' },
    });
    expect(alert.status()).toBe(200);

    const host = new URL(appUrl('/')).hostname;
    await page.context().addCookies([
      { name: '__gate_user', value: 'user_gate_superadmin', domain: host, path: '/', sameSite: 'Lax' },
    ]);
    await page.goto(appUrl('/admin'));
    await expect(page.locator('[data-testid="qa-unread-badge"]')).toBeVisible();

    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/admin/notifications/mark-read') && response.request().method() === 'POST'
    );
    await page.locator('[data-testid="qa-notifications-mark-read"]').click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);

    // The button intentionally performs window.location.reload() after a
    // successful protected write. Avoid a second reload: it races the first
    // navigation and can produce ERR_ABORTED even though the write succeeded.
    await expect(page.locator('[data-testid="qa-unread-badge"]')).toHaveCount(0, { timeout: 15_000 });
  });
});

test.describe('QA-2 smoke sweep (read-only self-test)', () => {
  test.skip(!mockMode || !CRON_SECRET, 'needs the GATE_MOCK harness with CRON_SECRET exported');

  test('GET /api/cron/qa-sweep: every critical check green, no business writes', async ({ request }) => {
    const res = await request.get(appUrl('/api/cron/qa-sweep'), {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    for (const name of ['landing', 'pricing', 'sign-in', 'api-health', 'dashboard-auth-gate', 'admin-auth-gate', 'database', 'webhook-hmac']) {
      expect(body.checks[name], `check "${name}" must be green`).toMatchObject({ ok: true });
    }
    for (const [name, check] of Object.entries<{ ok: boolean; detail: string }>(body.checks)) {
      expect(typeof check.detail).toBe('string');
      expect(check.detail.length).toBeGreaterThan(0);
      void name;
    }
    const warningChecks = ['operator', 'cron-fleet', 'qa-sweep/operator', 'qa-sweep/cron-fleet'];
    expect(body.alerts.filter((a: { check: string }) => !warningChecks.includes(a.check))).toEqual([]);
  });

  test('auth gating: the sweep refuses a bad secret (401)', async ({ request }) => {
    const res = await request.get(appUrl('/api/cron/qa-sweep'), {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    expect(res.status()).toBe(401);
  });
});
