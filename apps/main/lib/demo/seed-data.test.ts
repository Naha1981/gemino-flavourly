import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  DEMO_PLATFORM_KPIS,
  DEMO_TENANTS,
  DEMO_CONVERSATIONS,
  DEMO_REVIEWS,
  DEMO_VIPS,
  DEMO_CAMPAIGNS,
} from './seed-data.ts';

/**
 * GATE 2 — Demo Mode seed dataset invariants.
 *
 * The dataset must be DETERMINISTIC (identical bytes on every render, on
 * every machine — no Date.now / Math.random / env reads), REALISTIC
 * (ZAR economics, SA restaurants, WhatsApp-shaped transcripts), and
 * INTERNALLY CONSISTENT (MRR = tenants x price, ratings in range,
 * sentiment counts add up) — because the whole point of demo mode is
 * that a Super Admin can pitch from these numbers.
 */

describe('determinism', () => {
  test('deep-equal across fresh module loads (no Date.now/Math.random drift)', async () => {
    // Re-import the module through a distinct query so Node gives us a
    // second evaluation of it.
    const fresh = await import(`./seed-data.ts?cachebust=${Date.now()}`);
    assert.deepEqual(fresh.DEMO_PLATFORM_KPIS, DEMO_PLATFORM_KPIS);
    assert.deepEqual(fresh.DEMO_TENANTS, DEMO_TENANTS);
    assert.deepEqual(fresh.DEMO_CONVERSATIONS, DEMO_CONVERSATIONS);
    assert.deepEqual(fresh.DEMO_REVIEWS, DEMO_REVIEWS);
  });

  test('source contains no non-deterministic constructs', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'seed-data.ts'), 'utf8');
    // Strip comments first — the docblock itself MENTIONS the forbidden
    // constructs when it promises not to use them.
    const body = src
      .replace(/^import[^\n]*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(body, /Date\.now\(\)/);
    assert.doesNotMatch(body, /Math\.random/);
    assert.doesNotMatch(body, /process\.env/);
  });
});

describe('platform KPIs — internally consistent economics', () => {
  test('MRR is exactly tenants × R699', () => {
    assert.equal(DEMO_PLATFORM_KPIS.mrrZar, DEMO_PLATFORM_KPIS.totalTenants * 699);
  });

  test('active sockets ≤ total tenants (can never exceed the fleet)', () => {
    assert.ok(DEMO_PLATFORM_KPIS.activeSockets <= DEMO_PLATFORM_KPIS.totalTenants);
  });

  test('rating-monitored competitors ≤ competitors tracked', () => {
    assert.ok(DEMO_PLATFORM_KPIS.ratingMonitoredCompetitors <= DEMO_PLATFORM_KPIS.competitorsTracked);
  });

  test('missed revenue is a realistic ZAR magnitude (R10k–R500k)', () => {
    const zar = DEMO_PLATFORM_KPIS.missedRevenueCents / 100;
    assert.ok(zar >= 10_000 && zar <= 500_000, `unrealistic missed revenue: R${zar}`);
  });
});

describe('tenants — SA restaurant roster', () => {
  test('10 deterministic tenants with unique slugs and valid ISO dates', () => {
    assert.equal(DEMO_TENANTS.length, 10);
    const slugs = new Set(DEMO_TENANTS.map((t) => t.slug));
    assert.equal(slugs.size, DEMO_TENANTS.length);
    for (const t of DEMO_TENANTS) {
      assert.match(t.joinedDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(!Number.isNaN(Date.parse(t.joinedDate)));
    }
  });

  test('includes the anchor South African restaurants', () => {
    const names = DEMO_TENANTS.map((t) => t.name);
    assert.ok(names.includes('The Test Kitchen'));
    assert.ok(names.includes('Marble'));
    assert.ok(names.includes('Salsi'));
  });
});

describe('conversations — WhatsApp transcript shape', () => {
  test('every conversation has a transcript with valid senders and times', () => {
    assert.ok(DEMO_CONVERSATIONS.length >= 8);
    for (const c of DEMO_CONVERSATIONS) {
      assert.ok(c.transcript.length >= 1, `${c.id} empty transcript`);
      for (const m of c.transcript) {
        assert.ok(m.from === 'customer' || m.from === 'ai');
        assert.match(m.at, /^\d{2}:\d{2}$/);
        assert.ok(m.text.length > 0);
      }
      // SA phone format for the WhatsApp channel rows.
      if (c.channel === 'whatsapp') {
        assert.match(c.phone, /^\+27 \d{2} \d{3} \d{4}$/);
      }
    }
  });

  test('outcome vocabulary maps onto the live ConvoBadge states', () => {
    const statuses = new Set(DEMO_CONVERSATIONS.map((c) => c.status));
    for (const s of statuses) {
      assert.ok(['open', 'pending', 'closed', 'waiting'].includes(s), `unknown status ${s}`);
    }
  });
});

describe('reviews — reputation engine shape', () => {
  test('ratings in 1..5, sentiments valid, counts reconcile', () => {
    for (const r of DEMO_REVIEWS) {
      assert.ok(r.rating >= 1 && r.rating <= 5);
      assert.ok(['positive', 'neutral', 'negative'].includes(r.sentiment));
      assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    }
    const avg = DEMO_REVIEWS.reduce((a, r) => a + r.rating, 0) / DEMO_REVIEWS.length;
    assert.ok(avg >= 3.5 && avg <= 4.5, `demo average ${avg} outside a believable band`);
  });
});

describe('VIPs + campaigns', () => {
  test('VIP lifetime spend and visit counts are plausible', () => {
    for (const v of DEMO_VIPS) {
      assert.ok(v.visits >= 5);
      assert.ok(v.lifetimeSpendCents >= 250_000, `VIP spend too low: ${v.name}`);
    }
  });

  test('campaign redemption never exceeds opens, opens never exceed sends', () => {
    for (const c of DEMO_CAMPAIGNS) {
      assert.ok(c.redeemed <= c.opened, `${c.name}: redeemed > opened`);
      assert.ok(c.opened <= c.sent, `${c.name}: opened > sent`);
    }
  });
});
