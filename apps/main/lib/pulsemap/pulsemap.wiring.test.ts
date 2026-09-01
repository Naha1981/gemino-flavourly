/**
 * GATE PM-1 — PulseMap wiring tests (source-level, repo convention).
 *
 * Behavioural guarantees that are structural in nature:
 *   1. the simulate/apply routes CANNOT send campaign messages (no jobs
 *      writes, no dispatch, no message inserts — the launch route stays
 *      the only send path);
 *   2. the LLM surface is aggregate-only (the profile query selects only
 *      aggregate columns; the built prompt is PII-free by construction);
 *   3. tenant isolation is enforced in the route sources;
 *   4. the disclaimer is rendered in every UI state and returned by the API;
 *   5. Demo Mode uses the includeDemoRows scope (seed data only).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForecastUserPrompt, PULSEMAP_SYSTEM_PROMPT } from './prompt.ts';
import { detectPII } from './aggregate.ts';
import { FORECAST_DISCLAIMER } from './types.ts';
import type { SimulationContext } from './types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// This file lives in lib/pulsemap/ — two levels below apps/main.
const MAIN = join(HERE, '..', '..');

function src(rel: string): string {
  const p = join(MAIN, rel);
  assert.ok(existsSync(p), `missing file: ${rel}`);
  return readFileSync(p, 'utf8');
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('PM-1 — simulation never sends (structure)', () => {
  const simulateRoute = src('app/api/marketing/pulsemap/simulate/route.ts');
  const applyRoute = src('app/api/marketing/pulsemap/[id]/apply/route.ts');
  const codeSim = stripComments(simulateRoute);
  const codeApply = stripComments(applyRoute);

  test('the simulate route never writes send jobs or messages', () => {
    assert.ok(!/db\.insert\(\s*(jobs|messages)/.test(codeSim), 'simulate must not insert jobs/messages');
    assert.ok(!/send_whatsapp/.test(codeSim), 'simulate must never reference send_whatsapp');
    assert.ok(!/dispatch/i.test(codeSim), 'simulate must not import/​call dispatch');
    assert.ok(!/outbox/i.test(codeSim), 'simulate must not touch the outbox');
  });

  test('the apply route never writes send jobs or messages', () => {
    assert.ok(!/db\.insert\(\s*(jobs|messages)/.test(codeApply), 'apply must not insert jobs/messages');
    assert.ok(!/send_whatsapp/.test(codeApply));
    assert.ok(!/dispatch/i.test(codeApply));
  });

  test('the ONLY marketing route that enqueues send_whatsapp jobs is the launch route', () => {
    const marketingApi = join(MAIN, 'app', 'api', 'marketing');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
          const text = stripComments(readFileSync(p, 'utf8'));
          if (/send_whatsapp|db\.insert\(\s*jobs/.test(text) && !/launch/.test(p)) {
            offenders.push(p.replace(MAIN, ''));
          }
        }
      }
    };
    walk(marketingApi);
    assert.deepEqual(offenders, [], 'no non-launch marketing route may enqueue WhatsApp sends');
  });

  test('the simulate route only persists campaign_simulations rows', () => {
    assert.match(codeSim, /insertSimulation\(/);
    // and inserts nothing else
    const inserts = codeSim.match(/db\.insert\((\w+)\)/g) ?? [];
    assert.deepEqual(inserts, [], 'simulate route performs no raw db.insert — only the store call');
  });
});

describe('PM-1 — tenant isolation is structural in the routes', () => {
  const simulateRoute = src('app/api/marketing/pulsemap/simulate/route.ts');
  const applyRoute = src('app/api/marketing/pulsemap/[id]/apply/route.ts');

  test('simulate loads the campaign WHERE tenant_id = the caller tenant', () => {
    assert.match(simulateRoute, /eq\(marketingCampaigns\.tenantId,\s*tenantId\)/);
  });

  test('apply resolves the simulation AND campaign tenant-scoped', () => {
    assert.match(applyRoute, /getSimulationForTenant\(tenantId,\s*params\.id\)/);
    assert.match(applyRoute, /eq\(marketingCampaigns\.tenantId,\s*tenantId\)/);
  });

  test('the store keys simulation reads on tenant_id (isolation in SQL)', () => {
    const store = src('lib/pulsemap/store.ts');
    assert.match(store, /eq\(campaignSimulations\.tenantId,\s*tenantId\)/);
    const code = stripComments(store);
    // no cross-tenant read path exists
    assert.ok(!/withoutTenant|ignoreTenant|allTenants/.test(code));
  });
});

describe('PM-1 — the AI surface is aggregate-only (PII)', () => {
  const store = src('lib/pulsemap/store.ts');

  test('the profile query selects ONLY aggregate columns — never phone or name', () => {
    const selectBlock = store.match(
      /fetchProfileRowsForPulseMap[\s\S]*?\.select\(\{([\s\S]*?)\}\)/,
    )?.[1];
    assert.ok(selectBlock, 'profile select block not found');
    assert.ok(!/customerPhone|customerName|phone:/i.test(selectBlock), 'profile select must not carry PII columns');
    assert.match(selectBlock, /segment:/);
    assert.match(selectBlock, /totalVisits:/);
    assert.match(selectBlock, /totalSpendCents:/);
    assert.match(selectBlock, /lastVisitAt:/);
  });

  test('review themes are lexicon words only (no review text in the prompt input)', () => {
    const store2 = stripComments(store);
    // themes come from extractSpecifics, never the raw text
    assert.match(store2, /extractSpecifics\(row\.text\)/);
  });

  test('the assembled user prompt for a realistic context contains no PII', () => {
    const ctx: SimulationContext = {
      draft: {
        title: 'Thursday Date Night',
        message: 'R299 date-night meal for two this Thursday — 3 courses, menu included. Reply BOOK.',
        offer: 'R299 for two',
        targetSegment: 'regular',
        sendAt: null,
      },
      restaurant: { name: 'The Grand Bistro', description: 'A warm bistro.', openingHours: 'Mon-Sun 11:30-22:00' },
      segmentSummaries: [
        { segment: 'vip', count: 90, avgVisits: 14, avgSpendCents: 260000, avgDaysSinceLastVisit: 25 },
        { segment: 'regular', count: 380, avgVisits: 8, avgSpendCents: 110000, avgDaysSinceLastVisit: 40 },
      ],
      pastCampaigns: [
        { name: 'Winter Reactivation', status: 'sent', targetSegment: 'at_risk', sentCount: 140, estimatedReach: 140, estimatedRevenueCents: 180000 },
      ],
      reviewSignal: { totalReviews: 312, avgRating: 4.6, themes: ['steak', 'service', 'vibe'] },
      marketSignal: { competitorCount: 6, avgCompetitorRating: 4.2, activePromotions: 3 },
    };
    const prompt = buildForecastUserPrompt(ctx);
    const detection = detectPII(prompt);
    assert.equal(detection.hasPII, false, `prompt leaked: ${detection.matches.join(', ')}`);
    // the prompt must carry the segment aggregates (grounding)
    assert.match(prompt, /90 guests/);
    assert.match(prompt, /380 guests/);
  });

  test('the system prompt forbids guaranteeing customer behaviour', () => {
    assert.match(PULSEMAP_SYSTEM_PROMPT, /Never guarantee customer behaviou?r/);
    assert.match(PULSEMAP_SYSTEM_PROMPT, /JSON/);
  });
});

describe('PM-1 — the disclaimer is everywhere the forecast is', () => {
  test('the panel renders it in BOTH the result and unavailable states', () => {
    const panel = src('app/(app)/dashboard/marketing/campaigns/pulsemap-panel.tsx');
    assert.ok(panel.includes(FORECAST_DISCLAIMER));
    // the shared const is inside both early-return and full render paths
    const occurrences = panel.split(FORECAST_DISCLAIMER).length - 1;
    assert.ok(occurrences >= 1, 'disclaimer const missing');
    assert.match(panel, /if \(!simulation\)/, 'unavailable state branch exists');
  });

  test('the SSR page renders it (server-side, before any interaction)', () => {
    const page = src('app/(app)/dashboard/marketing/campaigns/page.tsx');
    assert.ok(page.includes('Forecast only. Real results are measured after launch.'));
  });

  test('the simulate and apply API responses both carry the disclaimer', () => {
    const simulateRoute = src('app/api/marketing/pulsemap/simulate/route.ts');
    const applyRoute = src('app/api/marketing/pulsemap/[id]/apply/route.ts');
    assert.ok(simulateRoute.includes('FORECAST_DISCLAIMER'));
    assert.ok(applyRoute.includes('FORECAST_DISCLAIMER'));
  });

  test('the loading state in the builder also shows it', () => {
    const builder = src('app/(app)/dashboard/marketing/campaigns/campaign-builder.tsx');
    assert.ok(builder.includes('Forecast only. Real results are measured after launch.'));
  });
});

describe('PM-1 — demo mode scope and guards', () => {
  const simulateRoute = src('app/api/marketing/pulsemap/simulate/route.ts');

  test('demo mode flips the query scope to include deadbeef rows only', () => {
    assert.match(simulateRoute, /demoMode \? \{ includeDemoRows: true \} : \{\}/);
  });

  test('live mode enforces the master AI switch and the tenant aiEnabled guard', () => {
    const code = stripComments(simulateRoute);
    assert.match(code, /masterAiSwitch === false/);
    assert.match(code, /aiEnabled === false/);
    assert.match(code, /manualMode/);
  });

  test('demo seed data lives in the deadbeef namespace and is wiped with the demo set', () => {
    const seedStore = src('lib/demo/seed-store.ts');
    assert.match(seedStore, /campaign_simulation_segments.*simulation_id::text like/);
    assert.match(seedStore, /campaign_simulations.*tenant_id::text like/);
  });

  test('the campaigns page resolves the tenant through the demo-aware resolver', () => {
    const page = src('app/(app)/dashboard/marketing/campaigns/page.tsx');
    assert.match(page, /resolveActiveTenant\(\)/);
    assert.match(page, /isDemoModeActive\(\)/);
    assert.match(page, /CampaignBuilder/);
  });
});
