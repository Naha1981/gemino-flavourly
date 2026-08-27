import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deadId, isDeadbeefId, DEADBEEF_PREFIX } from './deadbeef.ts';
import {
  generateCustomers,
  generateRevenueEvents,
  generateBookings,
  generateConversations,
  generateReviews,
  generateCampaigns,
  generateBriefs,
  generateCalendar,
  generateCompetitors,
  generateMarketAlerts,
  generateOpportunities,
  makeRng,
  CUSTOMER_PLAN,
  CUSTOMER_TOTAL,
} from './seed-generators.ts';

const NOW = new Date('2026-08-26T12:00:00.000Z');
const TENANT = '00000000-0000-0000-0000-00000000aaaa';

describe('demo ids — safety contract', () => {
  test('every demo id is a valid uuid prefixed deadbeef', () => {
    for (let i = 0; i < 50; i++) {
      const id = deadId('contact', i);
      assert.ok(id.startsWith(`${DEADBEEF_PREFIX}-`), id);
      assert.match(id, /^deadbeef-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/, id);
      assert.ok(isDeadbeefId(id));
    }
  });

  test('ids are deterministic per (namespace, index)', () => {
    assert.equal(deadId('booking', 7), deadId('booking', 7));
    assert.notEqual(deadId('booking', 7), deadId('booking', 8));
    assert.notEqual(deadId('booking', 7), deadId('review', 7));
  });

  test('real uuids never match the demo predicate', () => {
    assert.equal(isDeadbeefId('6f9619ff-8b86-d011-b42d-00c04fc964ff'), false);
    assert.equal(isDeadbeefId(null), false);
  });
});

describe('demo customers', () => {
  const customers = generateCustomers(TENANT, NOW);

  test('850 customers across the planned segments', () => {
    assert.equal(customers.length, CUSTOMER_TOTAL);
    assert.equal(CUSTOMER_TOTAL, 850);
    const by = (seg: string) => customers.filter((c) => c.segment === seg).length;
    assert.equal(by('vip'), CUSTOMER_PLAN.vip);
    assert.equal(by('regular'), CUSTOMER_PLAN.regular);
    assert.equal(by('at_risk'), CUSTOMER_PLAN.atRisk);
    assert.equal(by('dormant'), CUSTOMER_PLAN.dormant);
  });

  test('VIP economics stay inside the spec (LTV R4k–R45k, 10–90 visits)', () => {
    const vips = customers.filter((c) => c.vip);
    assert.equal(vips.length, 90);
    for (const v of vips) {
      assert.ok(v.totalSpendCents >= 400000 && v.totalSpendCents <= 4500000, v.id);
      assert.ok(v.totalVisits >= 10 && v.totalVisits <= 90, v.id);
    }
  });

  test('~12 birthdays fall inside the next 7 days', () => {
    const withBday = customers.filter((c) => c.birthday);
    assert.ok(withBday.length >= 10 && withBday.length <= 14, `got ${withBday.length}`);
    for (const c of withBday) {
      assert.match(c.birthday!, /^\d{2}-\d{2}$/);
    }
  });

  test('a few customers are opted out (blocklisted)', () => {
    const blocked = customers.filter((c) => c.blocklisted);
    assert.ok(blocked.length >= 4 && blocked.length <= 8);
  });

  test('~50 customers carry loyalty points', () => {
    const withPoints = customers.filter((c) => c.loyaltyPoints > 0);
    assert.ok(withPoints.length >= 45 && withPoints.length <= 55);
  });

  test('all ids unique and demo-prefixed', () => {
    const ids = new Set(customers.map((c) => c.id));
    assert.equal(ids.size, customers.length);
    assert.ok(customers.every((c) => isDeadbeefId(c.id)));
  });
});

describe('demo revenue', () => {
  const events = generateRevenueEvents(TENANT, NOW);

  test('90 days of verified revenue plus recovered events', () => {
    const verified = events.filter((e) => e.eventType === 'verified_booking');
    const recovered = events.filter((e) => e.eventType === 'recovered');
    assert.equal(verified.length, 90);
    assert.ok(recovered.length >= 25, 'recovered revenue cadence');
  });

  test('daily verified revenue stays R6k–R18k with weekend peaks', () => {
    const verified = events.filter((e) => e.eventType === 'verified_booking');
    let weekendSum = 0;
    let weekendCount = 0;
    let weekdaySum = 0;
    let weekdayCount = 0;
    for (const e of verified) {
      assert.ok(e.estimatedValueCents >= 600000 && e.estimatedValueCents <= 1800000, e.id);
      const dow = e.occurredAt.getDay();
      if (dow === 5 || dow === 6) {
        weekendSum += e.estimatedValueCents;
        weekendCount++;
      } else {
        weekdaySum += e.estimatedValueCents;
        weekdayCount++;
      }
    }
    assert.ok(weekendSum / weekendCount > weekdaySum / weekdayCount, 'Fri/Sat must peak');
  });

  test('recovered revenue totals ≈ R35k/month', () => {
    const recovered = events.filter((e) => e.eventType === 'recovered');
    const total = recovered.reduce((a, e) => a + e.estimatedValueCents, 0);
    // 90 days ≈ 3 months ⇒ ~R105k ± 30%.
    assert.ok(total > 70_000_00 && total < 150_000_00, `total ${total}`);
  });

  test('no future-dated past events', () => {
    for (const e of events) {
      assert.ok(e.occurredAt.getTime() <= NOW.getTime(), `future event ${e.id}`);
    }
  });
});

describe('demo bookings', () => {
  const customers = generateCustomers(TENANT, NOW);
  const bookings = generateBookings(TENANT, NOW, customers);

  test('120 past + 40 upcoming + 6 VIPs today', () => {
    const past = bookings.filter((b) => b.date.getTime() <= NOW.getTime());
    const upcoming = bookings.filter((b) => b.date.getTime() > NOW.getTime());
    assert.equal(past.length, 120);
    assert.equal(upcoming.length, 46); // 40 upcoming + 6 later-today VIPs
    const today = bookings.filter((b) => b.date.toDateString() === NOW.toDateString());
    assert.ok(today.length >= 6, 'VIPs booked today');
  });

  test('past bookings are mostly honoured (~8 no-show/cancel)', () => {
    const past = bookings.filter((b) => b.date.getTime() <= NOW.getTime());
    const bad = past.filter((b) => b.status === 'no_show' || b.status === 'cancelled');
    assert.ok(bad.length >= 6 && bad.length <= 12, `got ${bad.length}`);
    assert.ok(past.filter((b) => b.status === 'completed').length > 100);
  });

  test('past events are not future-dated; upcoming stay within 7 days', () => {
    for (const b of bookings) {
      if (b.status === 'completed' || b.status === 'no_show' || b.status === 'cancelled') {
        assert.ok(b.date.getTime() <= NOW.getTime());
      } else {
        assert.ok(b.date.getTime() > NOW.getTime() - 24 * 3600 * 1000);
        assert.ok(b.date.getTime() <= NOW.getTime() + 8 * 24 * 3600 * 1000);
      }
    }
  });
});

describe('demo conversations', () => {
  const customers = generateCustomers(TENANT, NOW);
  const convos = generateConversations(TENANT, NOW, customers);

  test('60 conversations, 25 active today, grounded AI replies', () => {
    assert.equal(convos.length, 60);
    const today = convos.filter((c) => c.createdAt.toDateString() === NOW.toDateString());
    assert.equal(today.length, 25);
    for (const c of convos) {
      assert.ok(c.messages.length >= 2);
      assert.equal(c.messages[0].direction, 'inbound');
      assert.equal(c.messages[1].direction, 'outbound');
      assert.equal(c.messages[1].isAIGenerated, true);
    }
  });

  test('exactly 2 YELLOW + 1 RED pending approval drafts', () => {
    const approvals = convos.filter((c) => c.approval);
    assert.equal(approvals.length, 3);
    assert.equal(approvals.filter((c) => c.approval!.riskLevel === 'yellow').length, 2);
    assert.equal(approvals.filter((c) => c.approval!.riskLevel === 'red').length, 1);
    for (const c of approvals) {
      assert.equal(c.approval!.status, 'pending');
    }
  });

  test('outcomes are tagged booked/waitlisted/deposit', () => {
    const tagged = convos.filter((c) => c.outcome);
    assert.ok(tagged.length >= 55);
    for (const c of tagged) {
      assert.ok(['booked', 'waitlisted', 'deposit'].includes(c.outcome!));
    }
  });
});

describe('demo reviews', () => {
  const reviews = generateReviews(TENANT, NOW);

  test('40 reviews averaging ≈4.6', () => {
    assert.equal(reviews.length, 40);
    const avg = reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
    assert.ok(Math.abs(avg - 4.6) < 0.01, `avg ${avg}`);
  });

  test('3 unanswered WITH AI drafts, incl. one 1-star "terrible service"', () => {
    const unanswered = reviews.filter((r) => r.responseSentAt === null);
    assert.equal(unanswered.length, 3);
    assert.ok(unanswered.every((r) => r.responseText && r.responseText.length > 20));
    const oneStar = unanswered.find((r) => r.rating === 1);
    assert.ok(oneStar, 'missing the 1-star review');
    assert.match(oneStar!.text, /[Tt]errible service/);
  });

  test('answered reviews carry sent replies', () => {
    const answered = reviews.filter((r) => r.responseSentAt !== null);
    assert.equal(answered.length, 37);
    assert.ok(answered.every((r) => r.responseText !== null));
  });
});

describe('demo marketing + market intelligence', () => {
  test('6 campaigns: 2 launched, 1 completed, 1 draft, 2 scheduled + attribution', () => {
    const campaigns = generateCampaigns(TENANT, NOW);
    assert.equal(campaigns.length, 6);
    const by = (s: string) => campaigns.filter((c) => c.status === s).length;
    assert.equal(by('launched'), 2);
    assert.equal(by('completed'), 1);
    assert.equal(by('draft'), 1);
    assert.equal(by('scheduled'), 2);
    const launched = campaigns.filter((c) => c.status === 'launched').map((c) => c.attributedCents);
    assert.ok(launched.includes(240000) && launched.includes(320000), 'R2,400 / R3,200 attribution');
    assert.ok(campaigns.every((c) => c.targetSegment && c.estimatedReach > 0));
  });

  test('briefs: today + 7 historical', () => {
    const briefs = generateBriefs(TENANT, NOW);
    assert.equal(briefs.length, 8);
    assert.equal(briefs[0].generatedAt.toDateString(), NOW.toDateString());
    for (const b of briefs) assert.ok(b.generatedAt.getTime() <= NOW.getTime());
  });

  test('7-day content calendar, mixed types, some posted', () => {
    const cal = generateCalendar(TENANT, NOW);
    assert.equal(cal.length, 7);
    const types = new Set(cal.map((e) => e.eventType));
    assert.ok(types.size >= 3);
    assert.ok(cal.some((e) => e.status === 'published'));
    assert.ok(cal.every((e) => e.startsAt.getTime() <= NOW.getTime() + 7 * 24 * 3600 * 1000));
  });

  test('market: 5 competitors, 2 menu alerts, 1 promo, 3 opportunities (brunch 0.85)', () => {
    const comps = generateCompetitors(TENANT);
    assert.equal(comps.length, 5);
    assert.ok(comps.every((c) => c.distanceKm && c.currentRating && c.reviewCount > 0));
    const alerts = generateMarketAlerts(NOW);
    assert.equal(alerts.snapshots.length, 2);
    assert.equal(alerts.promotions.length, 1);
    const opps = generateOpportunities(TENANT, NOW);
    assert.equal(opps.length, 3);
    const brunch = opps.find((o) => /Sunday brunch gap/i.test(o.title));
    assert.ok(brunch, 'missing Sunday brunch gap opportunity');
    assert.equal(brunch!.confidence, '0.85');
  });
});

describe('demo rng — determinism', () => {
  test('same seed produces identical datasets', () => {
    const a = generateCustomers(TENANT, NOW, makeRng(11));
    const b = generateCustomers(TENANT, NOW, makeRng(11));
    assert.deepEqual(a.map((c) => c.name), b.map((c) => c.name));
  });
});
