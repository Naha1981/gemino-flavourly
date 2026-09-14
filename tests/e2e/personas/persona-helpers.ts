import { type Page, type ConsoleMessage } from '@playwright/test';

/**
 * GATE QA-2 — Playwright persona suite helpers.
 *
 * SIX personas (owner spec): visitor, new owner, returning owner, prospect
 * magic-link, super admin, tenant-B negative.
 *
 * TWO run modes, chosen by the environment — never by editing the spec:
 *
 *   MOCK MODE (default for local + CI gate-mock job):
 *     GATE_BASE_URL points at a `GATE_MOCK=1` dev server (real app code,
 *     real middleware + authorization, pg-mem database, mock identity
 *     provider). A persona is a cookie (__gate_user = seeded userId) —
 *     exactly what gate-fixtures.ts does for the API suites. Everything
 *     except identity is REAL app code, which is the point.
 *
 *   PRODUCTION MODE:
 *     BASE_URL points at production. Signed-in journeys need the
 *     owner-provided credentials QA_EMAIL / QA_PASSWORD (env vars or
 *     GitHub secrets — NEVER hardcoded; a source-scan test enforces it).
 *     Without them, auth journeys SKIP loudly instead of silently passing.
 *
 * Production runs are READ-ONLY by design (no button writes) so a scheduled
 * run can never mutate live tenant data.
 */

export const PERSONA_COOKIE = '__gate_user';

export interface PersonaSpec {
  name: string;
  mockUserId: string | null;
  summary: string;
}

export const PERSONAS: Record<string, PersonaSpec> = {
  visitor: { name: 'visitor', mockUserId: null, summary: 'anonymous: landing, pricing, sign-in, auth-gate redirects' },
  newOwner: { name: 'new-owner', mockUserId: 'user_gate_tenantc', summary: 'Tenant C owner (disconnected, empty): onboarding + WhatsApp QR connect' },
  returningOwner: { name: 'returning-owner', mockUserId: 'user_gate_tenanta', summary: 'Tenant A owner (busy): every nav item, inbox, buttons' },
  prospectMagicLink: { name: 'prospect-magic-link', mockUserId: 'user_gate_prospect', summary: 'magic-link claimant: public claim page + gated redeem' },
  superAdmin: { name: 'super-admin', mockUserId: 'user_gate_superadmin', summary: 'naha.thabiso@gmail.com: /admin portal, notifications, demo toggle' },
  tenantBNegative: { name: 'tenant-B-negative', mockUserId: 'user_gate_tenantb', summary: 'Tenant B owner: cross-tenant isolation negatives' },
};

// Keep legacy implementation spellings available without changing the
// owner-specified six-key registry used by the QA contract.
Object.defineProperties(PERSONAS, {
  prospect: { value: PERSONAS.prospectMagicLink, enumerable: false },
  tenantB: { value: PERSONAS.tenantBNegative, enumerable: false },
});

export function isMockMode(): boolean { return Boolean(process.env.GATE_BASE_URL); }

export function productionCredentials(): { email: string; password: string } | null {
  const email = process.env.QA_EMAIL;
  const password = process.env.QA_PASSWORD;
  if (email && password) return { email, password };
  return null;
}

export function appUrl(path: string): string {
  const base = process.env.GATE_BASE_URL || process.env.BASE_URL || 'http://localhost:3100';
  return `${base.replace(/\/$/, '')}${path}`;
}

export async function signInMockPersona(page: Page, personaKey: keyof typeof PERSONAS): Promise<void> {
  const persona = PERSONAS[personaKey];
  const host = new URL(appUrl('/')).hostname;
  const existing = await page.context().cookies();
  const cleaned = existing.filter((c) => c.name !== PERSONA_COOKIE && c.name !== 'gemino_demo_mode');
  await page.context().clearCookies();
  await page.context().addCookies([
    ...cleaned,
    ...(persona.mockUserId
      ? [{ name: PERSONA_COOKIE, value: persona.mockUserId, domain: host, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' as const }]
      : []),
  ]);
}

export async function signInProduction(page: Page, creds: { email: string; password: string }): Promise<boolean> {
  await page.goto(appUrl('/sign-in'));
  const emailInput = page.locator('input[name="identifier"], input[inputmode="email"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 20_000 });
  await emailInput.fill(creds.email);
  await emailInput.press('Enter');
  const passwordInput = page.locator('input[type="password"]').first();
  try { await passwordInput.waitFor({ state: 'visible', timeout: 10_000 }); } catch { return false; }
  for (let i = 0; i < 20 && (await passwordInput.isDisabled().catch(() => true)); i++) await page.waitForTimeout(500);
  await passwordInput.fill(creds.password);
  await passwordInput.press('Enter');
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 30_000 }).catch(() => null);
  return /\/(dashboard|admin)/.test(page.url());
}

const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  /404.*dashboard|dashboard.*404/i,
  /the server responded with a status of 404/i,
  /Download the React DevTools/i,
];

export interface ConsoleCapture { errors: string[]; attach(): void; }

export function captureConsole(page: Page): ConsoleCapture {
  const errors: string[] = [];
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text))) return;
    errors.push(text);
  };
  const onPageError = (err: Error) => {
    const text = `${err.name}: ${err.message}`;
    if (IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text))) return;
    errors.push(text);
  };
  return { errors, attach() { page.on('console', onConsole); page.on('pageerror', onPageError); } };
}

import * as fs from 'node:fs';
import * as path from 'node:path';
export const ARTIFACT_DIR = path.join(process.cwd(), 'qa2-artifacts');
export async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}.png`), fullPage: false });
}

export const NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/inbox', label: 'Inbox' },
  { href: '/dashboard/customers', label: 'Customers' },
  { href: '/dashboard/customers/vip-today', label: 'VIP Today' },
  { href: '/dashboard/reputation', label: 'Reputation' },
  { href: '/dashboard/market/competitors', label: 'Market Intelligence' },
  { href: '/dashboard/marketing', label: 'Marketing' },
  { href: '/dashboard/marketing/campaigns', label: 'Campaigns' },
  { href: '/dashboard/marketing/events', label: 'Events' },
  { href: '/dashboard/marketing/calendar', label: 'Calendar' },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/dashboard/operations/channel-configs', label: 'Channels' },
  { href: '/dashboard/operations/approval-requests', label: 'Approvals' },
  { href: '/dashboard/whatsapp', label: 'WhatsApp' },
  { href: '/dashboard/billing', label: 'Billing' },
  { href: '/dashboard/settings', label: 'Settings' },
];