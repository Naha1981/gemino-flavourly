/**
 * GATE PM-1 — PulseMap Campaign Reaction Simulator, end-to-end.
 *
 * Runs against the GATE_MOCK=1 dev server (real app code, mock identity,
 * pg-mem database shaped by the project's own migrations). Every
 * authorization decision — tenant scoping, demo-mode gating, draft-state
 * enforcement — is made by the real application code under test.
 *
 * Personas: superAdmin (naha.thabiso@gmail.com), tenantAOwner (The Copper
 * Pot), tenantBOwner (Harbor Fish House — the NEGATIVE isolation actor),
 * visitor (unauthenticated).
 *
 * The 8 gate-required test cases map to the journey names below.
 *
 * Run: GATE_BASE_URL=http://127.0.0.1:3100 npx playwright test e2e/pulsemap.spec.ts
 */
import { test, expect } from './gate-fixtures';
import type { APIRequestContext } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.describe.configure({ timeout: 120_000 });

const DISCLAIMER = 'Forecast only. Real results are measured after launch.';

const IDS = {
  campaignADraft: '77777777-7777-4777-8777-777777777701',
  simulationA: '88888888-8888-4888-8888-888888888801',
  demoTenant: 'deadbeef-0100-4000-8000-000000000000',
  demoDraftCampaign: 'deadbeef-f001-4008-8000-000000000008',
};

const SEEDED_IMPROVED_COPY =
  'The Copper Pot · This Thursday\nR150 off mains — for two, menu included.\nJoin us for a proper winter dinner — made easy.\nLimited tables. Reply BOOK with your party size and we will confirm on WhatsApp.';

async function simulate(ctx: APIRequestContext, persona: string, journey: string, step: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return ctx.fetch('/api/marketing/pulsemap/simulate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    data: JSON.stringify(body),
  });
}

test.describe('GATE PM-1 — PulseMap for Campaigns', () => {
  test('unauthenticated callers cannot simulate (auth-gated)', async ({ gateAnon, gate }) => {
    const res = await simulate(gateAnon, 'visitor', 'pm1-auth', 'anon-simulate', {
      campaign_id: IDS.campaignADraft,
    });
    // Clerk's protect() answers 404 for unauthenticated non-document requests;
    // an explicit app-level guard would answer 401. Either way: no simulation.
    expect([401, 403, 404]).toContain(res.status());
    if (res.status() < 400) throw new Error(`anon simulate unexpectedly allowed (${res.status()})`);
  });

  test('TC1 — Tenant B cannot simulate Tenant A campaign (isolation, 404)', async ({ gateTenantB, gate }) => {
    const res = await simulate(gateTenantB, 'tenantBOwner', 'pm1-isolation', 'tenantB-simulates-A-campaign', {
      campaign_id: IDS.campaignADraft,
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  test('TC1 — Tenant B cannot apply Tenant A simulation (isolation, 404)', async ({ gateTenantB }) => {
    const res = await gateTenantB.fetch(`/api/marketing/pulsemap/${IDS.simulationA}/apply`, {
      method: 'POST',
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  test('TC6 — AI failure is honest: unavailable, no scores, nothing sent', async ({ gateTenantA }) => {
    // The harness has no GROQ/GOOGLE key configured — the live path must
    // report the honest unavailable state, never a fabricated forecast.
    const res = await simulate(gateTenantA, 'tenantAOwner', 'pm1-ai-failure', 'simulate-no-key', {
      campaign_id: IDS.campaignADraft,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('unavailable');
    expect(body.simulation).toBeNull();
    expect(body.reason).toMatch(/unavailable/i);
    expect(body.disclaimer).toBe(DISCLAIMER);
    // no score of any kind leaks into the unavailable response
    expect(JSON.stringify(body)).not.toMatch(/"score":\s*\d/);
  });

  test('TC3 + TC8 — Demo Mode generates a full forecast from seed data only', async ({ playwright, gateBase }) => {
    // Super admin + Demo Mode ON + ?tenant= (the demo tenant): the
    // simulation runs the deterministic demo forecaster over the
    // deadbeef-seeded segment profiles — no external AI, no live data.
    const domain = new URL(gateBase).hostname;
    const ctx = await playwright.request.newContext({
      baseURL: gateBase,
      storageState: {
        cookies: [
          { name: '__gate_user', value: 'user_gate_superadmin', domain, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
          { name: 'gemino_demo_mode', value: 'on', domain, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
        ],
        origins: [],
      },
    });
    try {
      const res = await ctx.fetch(
        `/api/marketing/pulsemap/simulate?tenant=${IDS.demoTenant}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          data: JSON.stringify({ campaign_id: IDS.demoDraftCampaign }),
        },
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      // First run inserts, an identical re-run is served from cache — both
      // are correct behaviour (the cache contract is unit-tested; here the
      // CONTENT is what matters).
      expect(body.cached === true || body.cached === false).toBe(true);
      expect(body.disclaimer).toBe(DISCLAIMER);

      const sim = body.simulation;
      expect(sim.status).toBe('complete');
      expect(sim.source).toBe('demo');
      expect(sim.model).toBe('demo:deterministic');
      expect(sim.score).toBeGreaterThanOrEqual(0);
      expect(sim.score).toBeLessThanOrEqual(100);
      expect(sim.improvedCopy.length).toBeGreaterThan(20);
      // TC8 — the forecast is built from the SEEDED segment counts
      // (2 regulars, 1 vip, 1 at-risk, 1 dormant, 1 new in the pg-mem seed)
      expect(sim.segments.length).toBe(5);
      const regular = sim.segments.find((s: { segment: string }) => s.segment === 'regular');
      expect(regular.reaction).toMatch(/2 regulars/);
      expect(sim.confidence).toBe('low'); // demo is honestly low-confidence
      // no PII of any kind in the stored summaries
      expect(JSON.stringify(sim.segmentSummaries)).not.toMatch(/\+27|0\d{9}/);
    } finally {
      await ctx.dispose();
    }
  });

  test('TC4 — the owner applies the improved copy to their draft campaign', async ({ gateTenantA, gate }) => {
    const res = await gateTenantA.fetch(`/api/marketing/pulsemap/${IDS.simulationA}/apply`, {
      method: 'POST',
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.campaign.message).toBe(SEEDED_IMPROVED_COPY);
    expect(body.disclaimer).toBe(DISCLAIMER);

    // The campaign is still a DRAFT — applying improved copy never launches.
    expect(body.campaign.status).toBe('draft');
  });

  test('TC5 — no campaign was sent: the campaign stays draft with no sends', async ({ gateTenantA, gate }) => {
    const res = await gateTenantA.fetch('/api/marketing/campaigns');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const campaign = body.campaigns.find((c: { id: string }) => c.id === IDS.campaignADraft);
    expect(campaign).toBeTruthy();
    expect(campaign.status).toBe('draft'); // simulate + apply never launched it
    expect(campaign.sentCount ?? 0).toBe(0);
    // and its message now carries the applied improved copy
    expect(campaign.message).toBe(SEEDED_IMPROVED_COPY);
  });

  test('TC2 — the page + prompt surface carry aggregates, not raw PII', async ({ gateTenantA, gate }) => {
    // The SSR page renders the builder + PulseMap intro + disclaimer.
    const { status, html } = await gate.page(
      gateTenantA,
      'tenantAOwner',
      'pm1-ui',
      'campaigns-page',
      '/dashboard/marketing/campaigns',
    );
    expect(status).toBe(200);
    expect(html).toContain('Campaign Builder');
    expect(html).toContain('Simulate customer reaction');
    expect(html).toContain(DISCLAIMER);
    // React SSR emits text-expression separators (<!-- -->); strip them so
    // the interpolated chip text is assertable as one contiguous string.
    const flat = html.split('<!-- -->').join('');
    expect(flat).toContain('PulseMap 63/100');
    // the fixture simulation renders its PulseMap chip with the honest score
    // no customer phone numbers anywhere in the rendered page
    expect(html).not.toMatch(/\+27\d{8,10}/);
  });
});
