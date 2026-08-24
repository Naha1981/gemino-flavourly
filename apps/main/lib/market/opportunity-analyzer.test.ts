import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOpportunities, type CompetitorEvidence } from './opportunity-analyzer.ts';

function competitor(overrides: Partial<CompetitorEvidence> = {}): CompetitorEvidence {
  return {
    name: 'Competitor',
    menuText: null,
    items: [],
    priceLevel: null,
    ...overrides,
  };
}

const competitorNames = (n: number) =>
  Array.from({ length: n }, (_, i) => competitor({ name: `Comp ${i + 1}` }));

describe('analyzeOpportunities (Gate #17)', () => {
  test('empty market yields NO opportunities (no evidence, no invention)', () => {
    assert.deepEqual(analyzeOpportunities([]), []);
  });

  test('a market with menus but no brunch flags the brunch gap with evidence', () => {
    const market = [
      competitor({ name: 'A', menuText: 'Dinner menu: steaks, ribs and curries' }),
      competitor({ name: 'B', menuText: 'Pizza and pasta, open for lunch and dinner' }),
      competitor({ name: 'C', menuText: 'Seafood platters and grills' }),
    ];
    const opportunities = analyzeOpportunities(market, { radiusKm: 5 });
    const brunch = opportunities.find((o) => o.opportunityKey === 'meal_type:brunch');
    assert.ok(brunch, 'brunch gap not detected');
    assert.match(brunch.description, /No competitor offers brunch/);
    assert.equal(brunch.evidence.competitorsScanned, 3);
    assert.equal(brunch.evidence.competitorsWithMenus, 3);
    assert.ok(brunch.confidence >= 0.7 && brunch.confidence <= 0.9, `confidence ${brunch.confidence}`);
  });

  test('a covered offering is NOT an opportunity', () => {
    const market = [
      competitor({ name: 'A', menuText: 'Sunday brunch buffet with bubbles' }),
      competitor({ name: 'B', menuText: 'breakfast all day' }),
      competitor({ name: 'C', menuText: 'vegan and gluten-free friendly' }),
    ];
    const opportunities = analyzeOpportunities(market);
    const keys = opportunities.map((o) => o.opportunityKey);
    assert.ok(!keys.includes('meal_type:brunch'), 'brunch is covered by A');
    assert.ok(!keys.includes('meal_type:breakfast'), 'breakfast is covered by B');
    assert.ok(!keys.includes('cuisine:vegan') && !keys.includes('cuisine:gluten_free'), 'covered by C');
    // But nobody offers halaal/kosher/late-night here:
    assert.ok(keys.includes('cuisine:halaal'));
    assert.ok(keys.includes('meal_type:late_night'));
  });

  test('keyword matching reads parsed item names too, not just raw text', () => {
    const market = [
      competitor({ name: 'A', items: [{ name: 'Vegan buddha bowl', priceCents: 12000 }] }),
      competitor({ name: 'B', menuText: 'burgers' }),
      competitor({ name: 'C', menuText: 'sushi' }),
    ];
    const keys = analyzeOpportunities(market).map((o) => o.opportunityKey);
    assert.ok(!keys.includes('cuisine:vegan'), 'vegan is covered via item name');
  });

  test('budget gap when nothing is priced under the threshold', () => {
    const market = [
      competitor({ name: 'A', items: [{ name: 'x', priceCents: 15000 }] }),
      competitor({ name: 'B', items: [{ name: 'y', priceCents: 22000 }] }),
      competitor({ name: 'C', items: [{ name: 'z', priceCents: 18000 }] }),
    ];
    const budget = analyzeOpportunities(market).find((o) => o.opportunityKey === 'price_point:budget');
    assert.ok(budget, 'budget gap not detected');
    assert.match(budget.description, /below R80/);
  });

  test('premium gap when nothing reaches the premium threshold', () => {
    const market = [
      competitor({ name: 'A', items: [{ name: 'x', priceCents: 6500 }] }),
      competitor({ name: 'B', items: [{ name: 'y', priceCents: 9000 }] }),
      competitor({ name: 'C', items: [{ name: 'z', priceCents: 12000 }] }),
    ];
    const premium = analyzeOpportunities(market).find((o) => o.opportunityKey === 'price_point:premium');
    assert.ok(premium, 'premium gap not detected');
    // And no budget gap (cheapest is R65):
    assert.ok(!analyzeOpportunities(market).some((o) => o.opportunityKey === 'price_point:budget'));
  });

  test('full-spread pricing closes both price gaps', () => {
    const market = [
      competitor({ name: 'A', items: [{ name: 'x', priceCents: 5500 }] }),
      competitor({ name: 'B', items: [{ name: 'y', priceCents: 35000 }] }),
      competitor({ name: 'C', menuText: 'mid-range' }),
    ];
    const keys = analyzeOpportunities(market).map((o) => o.opportunityKey);
    assert.ok(!keys.includes('price_point:budget'));
    assert.ok(!keys.includes('price_point:premium'));
  });

  test('confidence scales with the number of competitors scanned', () => {
    const one = analyzeOpportunities([competitor({ name: 'A', menuText: 'steaks' })])
      .find((o) => o.opportunityKey === 'cuisine:vegan')!.confidence;
    const six = analyzeOpportunities([
      ...competitorNames(6).map((c, i) => ({ ...c, menuText: `menu ${i}` })),
    ]).find((o) => o.opportunityKey === 'cuisine:vegan')!.confidence;
    assert.ok(one < 0.7, `single-competitor confidence too high: ${one}`);
    assert.ok(six >= 0.9, `six-competitor confidence too low: ${six}`);
  });

  test('competitors without any menu evidence weaken confidence honestly', () => {
    const allMenus = analyzeOpportunities([
      competitor({ name: 'A', menuText: 'x' }),
      competitor({ name: 'B', menuText: 'y' }),
      competitor({ name: 'C', menuText: 'z' }),
    ]).find((o) => o.opportunityKey === 'cuisine:vegan')!.confidence;

    const sparse = analyzeOpportunities([
      competitor({ name: 'A', menuText: 'x' }),
      competitor({ name: 'B' }), // no menu evidence
      competitor({ name: 'C' }), // no menu evidence
    ]).find((o) => o.opportunityKey === 'cuisine:vegan')!.confidence;

    assert.ok(sparse < allMenus, 'missing menus must weaken confidence');
  });

  test('every opportunity is well-formed (key, category, 0..1 confidence)', () => {
    const opportunities = analyzeOpportunities([
      competitor({ name: 'A', menuText: 'plain food' }),
      competitor({ name: 'B', menuText: 'more plain food' }),
    ]);
    assert.ok(opportunities.length > 0);
    for (const opportunity of opportunities) {
      assert.match(opportunity.opportunityKey, /^(meal_type|cuisine|price_point|time_slot):/);
      assert.ok(opportunity.confidence > 0 && opportunity.confidence <= 0.95);
      assert.ok(opportunity.description.length > 10);
      assert.equal(typeof opportunity.evidence.competitorsScanned, 'number');
    }
  });
});
