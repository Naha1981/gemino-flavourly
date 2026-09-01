/**
 * GATE V4 (All-Functionality) + GATE V5 (Runtime HTTP-level security) —
 * COMBINED. See e2e/gate-fixtures.ts for the environment adaptation note.
 *
 * Personas (Playwright storage states, cookie sessions against the mock
 * IdP; ALL app authorization runs for real against the seeded pg-mem DB):
 *   - superAdmin   naha.thabiso@gmail.com
 *   - tenantAOwner The Copper Pot        (positive tenant)
 *   - tenantBOwner Harbor Fish House     (NEGATIVE isolation tenant)
 *   - visitor      unauthenticated
 *
 * Every HTTP exchange is recorded to test-results/gate-evidence/network.jsonl
 * (request headers/body + status + response body) and page renders are
 * snapshotted to test-results/gate-evidence/html/ — the network log is the
 * "network logs proving 401/403 on negative tests" the directive requires.
 *
 * Run (fresh server boot — see GATE_REPORT_V4_V5.md for the exact command):
 *   GATE_BASE_URL=http://localhost:3000 npx playwright test e2e/gate-v4-v5.spec.ts
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './gate-fixtures';
import { GATE_IDS, GATE_WEBHOOK_SECRET } from './gate-fixtures';

test.describe.configure({ mode: 'serial' });
// First hit per route compiles in `next dev`; give each test generous headroom.
test.describe.configure({ timeout: 120_000 });

const WEBHOOK_URL = '/api/webhooks/whatsapp';

function signWebhook(body: string): string {
  return crypto.createHmac('sha256', GATE_WEBHOOK_SECRET).update(body).digest('hex');
}

/** After a webhook, find Tenant A's conversation that contains the probe text. */
async function findChatByText(
  tenantACtx: APIRequestContext,
  gate: ReturnType<typeof makeGateType>,
  journey: string,
  step: string,
  marker: string,
): Promise<{ html: string; status: number }> {
  const { html: inboxHtml } = await gate.page(tenantACtx, 'tenantAOwner', journey, `${step}-inbox-scan`, '/dashboard/inbox');
  const ids = [...new Set(inboxHtml.matchAll(/\/dashboard\/inbox\/([0-9a-f-]{36})/g).map((m) => m[1]))];
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    const { status, html } = await gate.page(
      tenantACtx,
      'tenantAOwner',
      journey,
      `${step}-conv-${id.slice(0, 8)}`,
      `/dashboard/inbox/${id}`,
    );
    if (html.includes(marker)) {
      return { status, html };
    }
  }
  throw new Error(`Journey ${journey} step ${step}: no Tenant A conversation contains ${JSON.stringify(marker)}`);
}

// Structural type for the `gate` fixture (kept local to avoid import cycles).
type GateApi = {
  page: (
    ctx: APIRequestContext,
    persona: string,
    journey: string,
    step: string,
    url: string,
    opts?: { followRedirects?: boolean },
  ) => Promise<{ res: unknown; status: number; html: string }>;
  request: (
    ctx: APIRequestContext,
    persona: string,
    journey: string,
    step: string,
    method: string,
    url: string,
    init?: { body?: unknown; headers?: Record<string, string>; followRedirects?: boolean },
  ) => Promise<{ res: unknown; status: number; body: string; json: () => any }>;
};
function makeGateType() {
  return null as unknown as GateApi;
}

// ---------------------------------------------------------------------------
// J1 — PUBLIC LANDING (unauthenticated visitor)
// ---------------------------------------------------------------------------
test.describe('J1 — Public landing, pricing, privacy (visitor)', () => {
  test('J1.1 landing page 200, next/image logo, no error markers', async ({ gateAnon, gate }) => {
    const { status, html } = await gate.page(gateAnon, 'visitor', 'J1', 'J1.1-landing', '/');
    expect(status).toBe(200);
    // Logo must render via next/image (V2 regression: <Image src="/logo.png">).
    expect(html).toContain('/_next/image?url=%2Flogo.png');
    expect(html).toContain('Full tables. Even on Tuesdays');
    expect(html).not.toContain('Internal Server Error');
    expect(html).not.toContain('Application error');
  });

  test('J1.2 pricing + privacy 200 with content', async ({ gateAnon, gate }) => {
    for (const [step, url] of [
      ['J1.2-pricing', '/pricing'],
      ['J1.2-privacy', '/privacy'],
    ] as const) {
      const { status, html } = await gate.page(gateAnon, 'visitor', 'J1', step, url);
      expect(status).toBe(200);
      expect(html.length).toBeGreaterThan(2000);
      expect(html).not.toContain('Internal Server Error');
    }
  });
});

// ---------------------------------------------------------------------------
// J2 — AUTH GATE (unauthenticated visitor hits /dashboard)
// ---------------------------------------------------------------------------
test.describe('J2 — Auth gate', () => {
  test('J2.1 unauthenticated /dashboard redirects to /sign-in (page request)', async ({ gateAnon, gate }) => {
    const { res, status } = await gate.page(gateAnon, 'visitor', 'J2', 'J2.1-dashboard-redirect', '/dashboard', {
      followRedirects: false,
    });
    // Clerk v5 protect(): page request -> redirect to sign-in.
    expect(status).toBe(307);
    const loc = ((res as { headers: () => Record<string, string> }).headers() as Record<string, string>)['location'] ?? '';
    expect(loc).toContain('/sign-in');
    expect(loc).toContain('redirect_url');
  });

  test('J2.2 unauthenticated API request gets 404 (Clerk API protect semantics)', async ({ gateAnon, gate }) => {
    // /api/tenant/list is a real, non-public route: the mock IdP (mirroring
    // Clerk v5 protect()) answers API requests with 404, not a redirect.
    const { status, json } = await gate.request(gateAnon, 'visitor', 'J2', 'J2.2-tenant-list-api', 'GET', '/api/tenant/list');
    expect(status).toBe(404);
    expect(json()).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// J3 — SUPER ADMIN GATE (non-admins must not reach /admin)
// ---------------------------------------------------------------------------
test.describe('J3 — Super-admin gate', () => {
  test('J3.1 visitor /admin redirects to sign-in', async ({ gateAnon, gate }) => {
    const { res, status } = await gate.page(gateAnon, 'visitor', 'J3', 'J3.1-admin-visitor', '/admin', {
      followRedirects: false,
    });
    expect(status).toBe(307);
    expect(((res as { headers: () => Record<string, string> }).headers() as Record<string, string>)['location'] ?? '').toContain('/sign-in');
  });

  test('J3.2 TENANT A (owner, not staff) /admin is DENIED', async ({ gateTenantA, gate }) => {
    const { res, status, html } = await gate.page(gateTenantA, 'tenantAOwner', 'J3', 'J3.2-admin-tenanta', '/admin', {
      followRedirects: false,
    });
    // The page's own fail-closed check (`!authorized -> redirect('/sign-in')`)
    // still runs and still fires. PR #36 added app/admin/loading.tsx, which
    // wraps the page in a Suspense boundary; Next 14 therefore streams that
    // redirect as a 200 shell with a <meta http-equiv="refresh"> to /sign-in
    // instead of a bare 307. Both transports prove the same property — the
    // user is sent to /sign-in — so accept either and assert the rest.
    const location =
      ((res as { headers: () => Record<string, string> }).headers() as Record<string, string>)['location'] ?? '';
    if (status === 307) {
      expect(location).toContain('/sign-in');
    } else {
      expect(status).toBe(200);
      expect(
        /http-equiv=["']refresh["'][^>]*url=\/sign-in/i.test(html),
        'expected a meta-refresh redirect to /sign-in in the SSR shell',
      ).toBe(true);
    }
    // Fail-closed: NO platform data may render to a non-super-admin.
    expect(html).not.toContain('Super Admin Platform Overview');
    expect(html).not.toContain('The Copper Pot');
    expect(html).not.toContain('Harbor Fish House');
  });

  test('J3.3 super admin /admin 200 and lists both seeded tenants', async ({ gateSa, gate }) => {
    const { status, html } = await gate.page(gateSa, 'superAdmin', 'J3', 'J3.3-admin-sa', '/admin');
    expect(status).toBe(200);
    expect(html).toContain('The Copper Pot');
    expect(html).toContain('Harbor Fish House');
    expect(html).not.toContain('Internal Server Error');
  });

  test('J3.4 runtime-migration endpoint: 403 for non-super-admins, 200 for SA', async ({
    gateAnon,
    gateTenantA,
    gateSa,
    gate,
  }) => {
    const anon = await gate.request(gateAnon, 'visitor', 'J3', 'J3.4-migrate-visitor', 'GET', '/api/migrate');
    expect(anon.status).toBe(403);
    expect(anon.json().error).toContain('Super Admin');

    const ta = await gate.request(gateTenantA, 'tenantAOwner', 'J3', 'J3.4-migrate-tenanta', 'GET', '/api/migrate');
    expect(ta.status).toBe(403);
    expect(ta.json().error).toContain('Super Admin');

    const sa = await gate.request(gateSa, 'superAdmin', 'J3', 'J3.4-migrate-sa', 'GET', '/api/migrate');
    expect(sa.status).toBe(200);
    expect(sa.json().ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// J4 — MAGIC LINK E2E (SA creates prospect -> builds demo tenant -> claim)
// ---------------------------------------------------------------------------
test.describe('J4 — Magic link E2E', () => {
  test('J4.1 prospect API is super-admin gated', async ({ gateAnon, gateTenantA, gate }) => {
    // Visitor: Clerk API protect -> 404.
    const anon = await gate.request(
      gateAnon,
      'visitor',
      'J4',
      'J4.1-prospects-visitor',
      'POST',
      '/api/prospects',
      { body: { name: 'Nope', website: 'https://nope.example' } },
    );
    expect(anon.status).toBe(404);

    // Tenant A owner: authenticated but NOT super admin -> 403 at the route.
    const ta = await gate.request(
      gateTenantA,
      'tenantAOwner',
      'J4',
      'J4.1-prospects-tenanta',
      'POST',
      '/api/prospects',
      { body: { name: 'Nope', website: 'https://nope.example' } },
    );
    expect(ta.status).toBe(403);
    expect(ta.json().error).toContain('Super Admin');
  });

  test('J4.2 SA creates prospect, builds demo tenant, claim link renders branding', async ({
    gateSa,
    gateAnon,
    gateTenantA,
    gate,
  }) => {
    const name = `Gate Prospect ${Date.now()}`;
    const created = await gate.request(
      gateSa,
      'superAdmin',
      'J4',
      'J4.2-prospects-create',
      'POST',
      '/api/prospects',
      { body: { name, website: 'https://gate-prospect.example' } },
    );
    expect(created.status).toBe(201);
    expect(created.json().ok).toBe(true);
    const prospectId: string = created.json().prospect.id;

    const built = await gate.request(
      gateSa,
      'superAdmin',
      'J4',
      'J4.2-prospects-build',
      'POST',
      `/api/prospects/${prospectId}/build`,
    );
    expect(built.status).toBe(200);
    expect(built.json().ok).toBe(true);
    expect(built.json()).toHaveProperty('tenantId');
    const { claimToken, claimLink } = built.json();
    expect(claimToken).toBeTruthy();
    expect(claimLink).toContain('/claim/');

    // Unauthenticated visitor opens the claim link: sees the prospect branding.
    const claimPage = await gate.page(gateAnon, 'visitor', 'J4', 'J4.2-claim-page', new URL(claimLink).pathname);
    expect(claimPage.status).toBe(200);
    expect(claimPage.html).toContain(name);
    expect(claimPage.html).toContain('/sign-up');

    // Magic link re-issues the SAME live token (30-day expiry).
    const magic = await gate.request(
      gateSa,
      'superAdmin',
      'J4',
      'J4.2-magic-link',
      'POST',
      `/api/prospects/${prospectId}/magic-link`,
    );
    expect(magic.status).toBe(200);
    expect(magic.json().token).toBe(claimToken);
    expect(magic.json()).toHaveProperty('expiresAt');

    // Tenant A cannot issue magic links.
    const denied = await gate.request(
      gateTenantA,
      'tenantAOwner',
      'J4',
      'J4.2-magic-link-tenanta',
      'POST',
      `/api/prospects/${prospectId}/magic-link`,
    );
    expect(denied.status).toBe(403);
  });

  test('J4.3 invalid claim token renders the invalid state (no 500, no phantom tenant)', async ({
    gateAnon,
    gate,
  }) => {
    const { status, html } = await gate.page(
      gateAnon,
      'visitor',
      'J4',
      'J4.3-claim-invalid',
      '/claim/gate-definitely-invalid-token-000',
    );
    expect(status).toBe(200);
    expect(html.toLowerCase()).toContain('invalid');
    expect(html).not.toContain('Internal Server Error');
  });
});

// ---------------------------------------------------------------------------
// J5 — TENANT ISOLATION (CRITICAL negative: Tenant B must not reach Tenant A)
// ---------------------------------------------------------------------------
test.describe('J5 — Tenant isolation (CRITICAL)', () => {
  const CONV_A1 = GATE_IDS.conversationA1;

  test('J5.1 TENANT B with a valid session posts to TENANT A conversation -> 404', async ({
    gateTenantB,
    gate,
  }) => {
    const r = await gate.request(
      gateTenantB,
      'tenantBOwner',
      'J5',
      'J5.1-cross-tenant-post',
      'POST',
      `/api/conversations/${CONV_A1}/messages`,
      { body: { content: 'cross-tenant probe — must be rejected' } },
    );
    expect(r.status).toBe(404);
    expect(r.json().error).toBe('Conversation not found');
  });

  test('J5.2 unauthenticated post to the same conversation -> rejected', async ({ gateAnon, gate }) => {
    const r = await gate.request(
      gateAnon,
      'visitor',
      'J5',
      'J5.2-anon-post',
      'POST',
      `/api/conversations/${CONV_A1}/messages`,
      { body: { content: 'anon probe' } },
    );
    expect([401, 403, 404]).toContain(r.status);
  });

  test('J5.3 TENANT A posts to its OWN conversation -> 200 (positive control)', async ({ gateTenantA, gate }) => {
    const r = await gate.request(
      gateTenantA,
      'tenantAOwner',
      'J5',
      'J5.3-own-tenant-post',
      'POST',
      `/api/conversations/${CONV_A1}/messages`,
      { body: { content: 'hello from the gate' } },
    );
    expect(r.status).toBe(200);
    expect(r.json().ok).toBe(true);
    expect(r.json().message.tenantId).toBe(GATE_IDS.tenantA);
  });

  test('J5.4 TENANT B inbox does NOT contain TENANT A customers (data-level isolation)', async ({
    gateTenantA,
    gateTenantB,
    gate,
  }) => {
    const a = await gate.page(gateTenantA, 'tenantAOwner', 'J5', 'J5.4-inbox-a', '/dashboard/inbox');
    expect(a.status).toBe(200);
    expect(a.html).toContain('Thabo Mokoena');

    const b = await gate.page(gateTenantB, 'tenantBOwner', 'J5', 'J5.4-inbox-b', '/dashboard/inbox');
    expect(b.status).toBe(200);
    expect(b.html).not.toContain('Thabo Mokoena');
    expect(b.html).not.toContain('Lerato Khumalo');
  });
});

// ---------------------------------------------------------------------------
// J6 — INBOX & DELIVERY TRUTH (no fake green ticks)
// ---------------------------------------------------------------------------
test.describe('J6 — Inbox delivery-state rendering', () => {
  test('J6.1 seeded conversation renders every delivery state truthfully', async ({ gateTenantA, gate }) => {
    const { status, html } = await gate.page(
      gateTenantA,
      'tenantAOwner',
      'J6',
      'J6.1-chat-delivery-states',
      `/dashboard/inbox/${GATE_IDS.conversationA1}`,
    );
    expect(status).toBe(200);
    // delivered -> double tick with the exact aria-label.
    expect(html.match(/aria-label="Delivered"/g)).toHaveLength(1);
    // sent -> single tick, explicitly NOT claimed as delivered.
    expect(html.match(/aria-label="Sent \(dispatched, not confirmed delivered\)"/g)).toHaveLength(1);
    // queued -> "Sending".
    expect(html).toContain('>Sending<');
    // failed -> "Not delivered" with the recorded delivery error.
    expect(html).toContain('Not delivered');
    expect(html).toContain('retries exhausted after 5 attempts');
    // unknown -> "Unknown" (never a green tick).
    expect(html).toContain('>Unknown<');
  });

  test('J6.2 legacy conversation (NULL delivery status) renders NO tick at all', async ({
    gateTenantA,
    gate,
  }) => {
    const { status, html } = await gate.page(
      gateTenantA,
      'tenantAOwner',
      'J6',
      'J6.2-chat-legacy-null-status',
      `/dashboard/inbox/${GATE_IDS.conversationA2}`,
    );
    expect(status).toBe(200);
    expect(html).not.toContain('aria-label="Delivered"');
    expect(html).not.toContain('aria-label="Sent (dispatched, not confirmed delivered)"');
  });
});

// ---------------------------------------------------------------------------
// J7 — HARD RULES: master kill switch + webhook HMAC
// ---------------------------------------------------------------------------
test.describe('J7 — Kill switch + webhook hard rules', () => {
  test('J7.1 control: valid HMAC inbound -> AI reply generated (offline deterministic fallback)', async ({
    gateTenantA,
    gate,
  }) => {
    const phone = '+27825550040';
    const text = 'Can I see the menu, please?';
    const payload = {
      waAccountId: GATE_IDS.waAccountA,
      message: {
        key: { remoteJid: `${phone}@s.whatsapp.net`, id: 'GATE-J7-CTRL' },
        pushName: 'Gate Probe',
        message: { conversation: text },
      },
    };
    const body = JSON.stringify(payload);
    const r = await gate.request(
      gateTenantA,
      'webhook',
      'J7',
      'J7.1-webhook-control',
      'POST',
      WEBHOOK_URL,
      { headers: { 'x-webhook-signature': signWebhook(body) }, body },
    );
    expect(r.status).toBe(200);
    expect(r.json().ok).toBe(true);

    // The deterministic MENU reply must be present in the new conversation.
    const { html } = await findChatByText(gateTenantA, gate as unknown as GateApi, 'J7', 'J7.1-chat-control', text);
    expect(html).toContain('/m/copper-pot');
  });

  test('J7.2 invalid HMAC signature -> 401 (fails closed)', async ({ gateAnon, gate }) => {
    const payload = {
      waAccountId: GATE_IDS.waAccountA,
      message: {
        key: { remoteJid: '+27825550043@s.whatsapp.net', id: 'GATE-J7-BADSIG' },
        pushName: 'Gate Probe',
        message: { conversation: 'this must be rejected' },
      },
    };
    const body = JSON.stringify(payload);
    const r = await gate.request(
      gateAnon,
      'webhook',
      'J7',
      'J7.2-webhook-bad-signature',
      'POST',
      WEBHOOK_URL,
      { headers: { 'x-webhook-signature': 'deadbeef'.repeat(8) }, body },
    );
    expect(r.status).toBe(401);
    expect(r.json().error).toBe('Invalid HMAC signature');
  });

  test('J7.3 kill switch OFF: SA toggles master, inbound recorded but NO AI reply', async ({
    gateTenantA,
    gateSa,
    gate,
  }) => {
    // Non-admin cannot touch the switch.
    const denied = await gate.request(
      gateTenantA,
      'tenantAOwner',
      'J7',
      'J7.3-toggle-tenanta',
      'POST',
      '/api/admin/toggle-ai',
      { body: { enabled: false } },
    );
    expect(denied.status).toBe(403);
    expect(denied.json().error).toContain('Super Admin');

    const off = await gate.request(
      gateSa,
      'superAdmin',
      'J7',
      'J7.3-toggle-off',
      'POST',
      '/api/admin/toggle-ai',
      { body: { enabled: false } },
    );
    expect(off.status).toBe(200);
    expect(off.json().globalAiEnabled).toBe(false);

    const phone = '+27825550041';
    const text = 'Hello there!';
    const payload = {
      waAccountId: GATE_IDS.waAccountA,
      message: {
        key: { remoteJid: `${phone}@s.whatsapp.net`, id: 'GATE-J7-SUPP' },
        pushName: 'Gate Probe',
        message: { conversation: text },
      },
    };
    const body = JSON.stringify(payload);
    const r = await gate.request(
      gateTenantA,
      'webhook',
      'J7',
      'J7.3-webhook-suppressed',
      'POST',
      WEBHOOK_URL,
      { headers: { 'x-webhook-signature': signWebhook(body) }, body },
    );
    expect(r.status).toBe(200);
    expect(r.json().note).toBe('AI reply suppressed (global kill switch or tenant AI disabled)');

    // The inbound message is still recorded (history stays truthful) but no
    // outbound AI reply exists in the thread.
    const { html } = await findChatByText(gateTenantA, gate as unknown as GateApi, 'J7', 'J7.3-chat-suppressed', text);
    expect(html).toContain(text); // inbound recorded
    expect(html).not.toContain('/m/copper-pot'); // no AI reply
  });

  test('J7.4 kill switch ON again: AI replies resume', async ({ gateTenantA, gateSa, gate }) => {
    const on = await gate.request(gateSa, 'superAdmin', 'J7', 'J7.4-toggle-on', 'POST', '/api/admin/toggle-ai', {
      body: { enabled: true },
    });
    expect(on.status).toBe(200);
    expect(on.json().globalAiEnabled).toBe(true);

    const phone = '+27825550042';
    const text = 'What time do you open?';
    const payload = {
      waAccountId: GATE_IDS.waAccountA,
      message: {
        key: { remoteJid: `${phone}@s.whatsapp.net`, id: 'GATE-J7-REST' },
        pushName: 'Gate Probe',
        message: { conversation: text },
      },
    };
    const body = JSON.stringify(payload);
    const r = await gate.request(
      gateTenantA,
      'webhook',
      'J7',
      'J7.4-webhook-restored',
      'POST',
      WEBHOOK_URL,
      { headers: { 'x-webhook-signature': signWebhook(body) }, body },
    );
    expect(r.status).toBe(200);
    expect(r.json().ok).toBe(true);

    const { html } = await findChatByText(gateTenantA, gate as unknown as GateApi, 'J7', 'J7.4-chat-restored', text);
    expect(html).toContain('Trading Hours');
  });
});

// ---------------------------------------------------------------------------
// GATE-WIDE: zero 5xx across the entire recorded network log (the API/SSR
// analogue of "zero console errors allowed for PASS").
// ---------------------------------------------------------------------------
test('GATE — no 5xx in any recorded exchange of this run', async () => {
  const log = fs.readFileSync('test-results/gate-evidence/network.jsonl', 'utf8');
  const lines = log.split('\n').filter(Boolean);
  expect(lines.length).toBeGreaterThan(10);
  const bad = lines.map((l) => JSON.parse(l)).filter((e: { status: number }) => e.status >= 500);
  expect(bad, `5xx responses recorded:\n${bad.map((b: { method: string; url: string; status: number }) => `  ${b.method} ${b.url} -> ${b.status}`).join('\n')}`).toHaveLength(0);
});
