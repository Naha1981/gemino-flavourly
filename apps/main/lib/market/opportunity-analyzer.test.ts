import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUISINES,
  MEAL_SLOTS,
  TIME_SLOTS,
  analyzeOpportunities,
  averagePrice,
  coversCuisine,
  formatOpportunity,
  priceRangeFromString,
  scoreGap,
  servesMeal,
  slugify,
  tradesInSlot,
  type CompetitorOffering,
  type TenantOffering,
} from './opportunity-analyzer.ts';

function competitor(overrides: Partial<CompetitorOffering> = {}): CompetitorOffering {
  return {
    id: overrides.id ?? 'comp-1',
    name: overrides.name ?? 'A Restaurant',
    distanceKm: overrides.distanceKm === undefined ? 2 : overrides.distanceKm,
    menuItems: overrides.menuItems ?? [],
    menuText: overrides.menuText ?? null,
    priceRange: overrides.priceRange ?? null,
    placeTypes: overrides.placeTypes ?? [],
    serves: overrides.serves ?? [],
    priceLevel: overrides.priceLevel ?? null,
    rating: overrides.rating ?? null,
  };
}

function tenant(overrides: Partial<TenantOffering> = {}): TenantOffering {
  return {
    name: overrides.name ?? 'My Restaurant',
    menuItems: overrides.menuItems ?? [],
    menuText: overrides.menuText ?? null,
    placeTypes: overrides.placeTypes ?? [],
    serves: overrides.serves ?? [],
    openingHours: overrides.openingHours ?? null,
    priceLevel: overrides.priceLevel ?? null,
  };
}

/** N competitors with a plain steak-and-chips menu: no brunch, no breakfast. */
function plainFleet(count: number, startDistance = 0.5): CompetitorOffering[] {
  return Array.from({ length: count }, (_unused, i) =>
    competitor({
      id: `comp-${i}`,
      name: `Steak House ${i}`,
      distanceKm: startDistance + i * 0.3,
      menuItems: [
        { name: 'Ribeye steak', price: 280, category: 'Mains' },
        { name: 'Chips', price: 45, category: 'Sides' },
      ],
      menuText: 'Mains\nRibeye steak R280\nChips R45',
      placeTypes: ['steak_house', 'restaurant'],
    })
  );
}

describe('opportunity analyzer: scoring', () => {
  test('the documented formula adds up', () => {
    assert.equal(scoreGap({ competitorsOffering: 0, competitorsAnalysed: 8, tenantOffers: true }), 0.85);
    assert.equal(scoreGap({ competitorsOffering: 0, competitorsAnalysed: 2, tenantOffers: false }), 0.6);
    assert.equal(scoreGap({ competitorsOffering: 1, competitorsAnalysed: 12, tenantOffers: true, weak: true }), 0.6);
    // The "nobody offers it" bonus applies even to a degenerate sample; in
    // practice analyzeOpportunities returns [] before scoring that case.
    assert.equal(scoreGap({ competitorsOffering: 0, competitorsAnalysed: 0, tenantOffers: false }), 0.6);
  });

  test('the score is capped at 0.95 and floored at 0.05', () => {
    assert.ok(scoreGap({ competitorsOffering: 0, competitorsAnalysed: 100, tenantOffers: true }) <= 0.95);
    assert.ok(scoreGap({ competitorsOffering: 5, competitorsAnalysed: 100, tenantOffers: false, weak: true }) >= 0.05);
  });

  test('slugify produces stable keys', () => {
    assert.equal(slugify('Sunday Brunch!'), 'sunday_brunch');
    assert.equal(slugify('  gluten-free  '), 'gluten_free');
  });

  test('price ranges parse back for the price-band detector', () => {
    assert.deepEqual(priceRangeFromString('R100-R200 per person'), { min: 100, max: 200 });
    assert.equal(priceRangeFromString(null), null);
    assert.equal(priceRangeFromString('unknown'), null);
  });

  test('average price prefers parsed items, then the stored band', () => {
    assert.equal(
      averagePrice({ menuItems: [{ name: 'A', price: 100, category: null }, { name: 'B', price: 200, category: null }], priceRange: null }),
      150
    );
    assert.equal(averagePrice({ menuItems: [], priceRange: { min: 100, max: 200 } }), 150);
    assert.equal(averagePrice({ menuItems: [], priceRange: null }), null);
  });
});

describe('opportunity analyzer: evidence matchers', () => {
  test('a Google serves flag beats a menu keyword, but both count', () => {
    assert.equal(servesMeal(competitor({ serves: ['brunch'] }), MEAL_SLOTS[1]), 'Google lists "brunch"');
    assert.equal(servesMeal(competitor({ menuText: 'Weekend brunch R180' }), MEAL_SLOTS[1]), 'menu mentions "brunch"');
    assert.equal(servesMeal(competitor({ menuText: 'Steak and chips' }), MEAL_SLOTS[1]), null);
  });

  test('place types are matched against Google cuisine suffixes', () => {
    assert.equal(
      coversCuisine(competitor({ placeTypes: ['italian_restaurant'] }), CUISINES.find((c) => c.key === 'italian')!),
      'Google classifies it as Italian'
    );
    assert.equal(coversCuisine(competitor({ menuText: 'Handmade pasta R150' }), CUISINES.find((c) => c.key === 'italian')!), 'menu mentions "pasta"');
    assert.equal(coversCuisine(competitor({ placeTypes: ['cafe'] }), CUISINES.find((c) => c.key === 'italian')!), null);
  });

  test('time slots match trading language, not dish names alone', () => {
    assert.equal(tradesInSlot(competitor({ menuText: 'Open late Fridays till midnight' }), TIME_SLOTS[0]), 'menu mentions "open late"');
    assert.equal(tradesInSlot(competitor({ menuText: 'Sunday roasts R150' }), TIME_SLOTS[1]), 'menu mentions "sunday"');
    assert.equal(tradesInSlot(competitor({ menuText: 'Steak R280' }), TIME_SLOTS[1]), null);
  });
});

describe('opportunity analyzer: gap detection', () => {
  test('the gate example: nobody offers Sunday brunch within 5km, score 0.85', () => {
    const opportunities = analyzeOpportunities({
      tenant: tenant({ menuText: 'Sunday brunch: eggs benedict R95, shakshuka R85', serves: ['brunch'] }),
      competitors: plainFleet(8),
      radiusKm: 5,
    });

    const sundayBrunch = opportunities.find((opportunity) => opportunity.key === 'time_gap:sunday_brunch');
    assert.ok(sundayBrunch, `no sunday_brunch opportunity in ${opportunities.map((o) => o.key).join(', ')}`);
    assert.equal(sundayBrunch.confidence, 0.85);
    assert.equal(
      formatOpportunity(sundayBrunch),
      'Sunday brunch: no competitor within 5km. Opportunity score: 0.85'
    );
    assert.deepEqual(sundayBrunch.evidence[0], '0 of 8 competitors within 5km show evidence of Sunday brunch');
  });

  test('a meal nobody serves is reported, with the tenant angle when it applies', () => {
    const opportunities = analyzeOpportunities({
      tenant: tenant({ menuText: 'Breakfast served from 07:00: full english R85' }),
      competitors: plainFleet(6),
      radiusKm: 5,
    });

    const breakfast = opportunities.find((opportunity) => opportunity.key === 'meal_gap:breakfast');
    assert.ok(breakfast);
    assert.equal(breakfast.confidence, 0.85);
    assert.match(breakfast.description, /You already do/);
    assert.ok(breakfast.evidence.includes('your own menu already covers breakfast'));

    const brunch = opportunities.find((opportunity) => opportunity.key === 'meal_gap:brunch');
    assert.ok(brunch);
    assert.equal(brunch.confidence, 0.7, 'the tenant does not offer brunch, so it scores lower');
    assert.match(brunch.description, /uncontested/);
  });

  test('"almost nobody" is a weaker opportunity than "nobody"', () => {
    const fleet = plainFleet(12);
    fleet[0] = competitor({ ...fleet[0], serves: ['brunch'] });

    const opportunities = analyzeOpportunities({
      tenant: tenant({ serves: ['brunch'] }),
      competitors: fleet,
      radiusKm: 5,
    });

    const brunch = opportunities.find((opportunity) => opportunity.key === 'meal_gap:brunch');
    assert.ok(brunch);
    assert.equal(brunch.confidence, 0.6);
    assert.match(brunch.title, /Only 1 competitor/);
  });

  test('a well-served slot is not reported as a gap at all', () => {
    const fleet = plainFleet(10).map((entry) => ({ ...entry, serves: ['brunch', 'breakfast'] }));
    const opportunities = analyzeOpportunities({ tenant: tenant(), competitors: fleet, radiusKm: 5 });
    assert.equal(opportunities.find((opportunity) => opportunity.key === 'meal_gap:brunch'), undefined);
    assert.equal(opportunities.find((opportunity) => opportunity.key === 'meal_gap:breakfast'), undefined);
  });

  test('a cuisine gap is found from place types alone', () => {
    const opportunities = analyzeOpportunities({
      tenant: tenant({ menuText: 'Vegan bobotie R120, vegan curry R110' }),
      competitors: plainFleet(6),
      radiusKm: 5,
    });
    const vegan = opportunities.find((opportunity) => opportunity.key === 'cuisine_gap:vegan');
    assert.ok(vegan);
    assert.equal(vegan.opportunityType, 'cuisine_gap');
    assert.match(vegan.description, /unique selling point/);
    assert.equal(vegan.confidence, 0.85);
  });

  test('a price band nobody occupies is a price gap', () => {
    // Every competitor averages R165 per dish -> no budget (<R100) option.
    const fleet = plainFleet(6).map((entry) => ({
      ...entry,
      menuItems: [{ name: 'Platter', price: 165, category: null }],
    }));
    const opportunities = analyzeOpportunities({
      tenant: tenant({ menuItems: [{ name: 'Toast', price: 55, category: null }] }),
      competitors: fleet,
      radiusKm: 5,
    });

    const budget = opportunities.find((opportunity) => opportunity.key === 'price_gap:budget');
    assert.ok(budget, `no budget gap in ${opportunities.map((o) => o.key).join(', ')}`);
    assert.equal(budget.opportunityType, 'price_gap');
    assert.match(budget.title, /under R100/);
    assert.equal(budget.confidence, 0.85, 'the tenant already sits in the budget band');

    const premium = opportunities.find((opportunity) => opportunity.key === 'price_gap:premium');
    assert.ok(premium);
    assert.equal(premium.confidence, 0.7, 'the tenant is not premium, so it scores lower');
  });

  test('no price evidence means no invented price gap', () => {
    const opportunities = analyzeOpportunities({
      tenant: tenant(),
      competitors: plainFleet(6).map((entry) => ({ ...entry, menuItems: [], menuText: null })),
      radiusKm: 5,
    });
    assert.equal(opportunities.find((opportunity) => opportunity.key === 'price_gap:budget'), undefined);
  });

  test('an empty market reports nothing rather than guessing', () => {
    assert.deepEqual(analyzeOpportunities({ tenant: tenant(), competitors: [], radiusKm: 5 }), []);
  });
});

describe('opportunity analyzer: scoping and stability', () => {
  test('competitors outside the radius do not dilute the sample', () => {
    const far = plainFleet(6).map((entry) => ({ ...entry, serves: ['brunch'] as string[], distanceKm: 12 }));
    const near = plainFleet(2).map((entry) => ({ ...entry, id: `${entry.id}-near`, distanceKm: 1 }));

    const opportunities = analyzeOpportunities({ tenant: tenant(), competitors: [...far, ...near], radiusKm: 5 });
    const brunch = opportunities.find((opportunity) => opportunity.key === 'meal_gap:brunch');
    assert.ok(brunch, 'the six brunch places are 12km away and must not cancel the gap');
    assert.match(brunch.evidence[0], /0 of 2 competitors within 5km/);
  });

  test('a competitor with unknown distance still counts as local', () => {
    const fleet = plainFleet(5).map((entry) => ({ ...entry, serves: ['brunch'] as string[], distanceKm: null }));
    const opportunities = analyzeOpportunities({ tenant: tenant(), competitors: fleet, radiusKm: 5 });
    assert.equal(opportunities.find((opportunity) => opportunity.key === 'meal_gap:brunch'), undefined);
  });

  test('results are ordered best-first and deterministically', () => {
    const opportunities = analyzeOpportunities({
      tenant: tenant({ menuText: 'Vegan breakfast and brunch every day' }),
      competitors: plainFleet(8),
      radiusKm: 5,
    });
    const confidences = opportunities.map((opportunity) => opportunity.confidence);
    assert.deepEqual(confidences, [...confidences].sort((a, b) => b - a));

    const again = analyzeOpportunities({
      tenant: tenant({ menuText: 'Vegan breakfast and brunch every day' }),
      competitors: plainFleet(8),
      radiusKm: 5,
    });
    assert.deepEqual(
      again.map((opportunity) => opportunity.key),
      opportunities.map((opportunity) => opportunity.key),
      'the same input must produce the same order'
    );
  });

  test('keys are stable across runs so a re-run updates rather than duplicates', () => {
    const first = analyzeOpportunities({ tenant: tenant(), competitors: plainFleet(6), radiusKm: 5 });
    const second = analyzeOpportunities({ tenant: tenant(), competitors: plainFleet(6), radiusKm: 5 });
    assert.deepEqual(new Set(first.map((o) => o.key)), new Set(second.map((o) => o.key)));
    for (const opportunity of first) {
      assert.match(opportunity.key, /^[a-z_]+:[a-z0-9_]+$/, `unstable key shape: ${opportunity.key}`);
    }
  });

  test('every opportunity carries the fields the store and UI need', () => {
    const opportunities = analyzeOpportunities({ tenant: tenant(), competitors: plainFleet(6), radiusKm: 5 });
    assert.ok(opportunities.length > 0);
    for (const opportunity of opportunities) {
      assert.ok(opportunity.title.length > 0);
      assert.ok(opportunity.description.length > 0);
      assert.ok(['meal_gap', 'cuisine_gap', 'price_gap', 'time_gap'].includes(opportunity.opportunityType));
      assert.ok(opportunity.confidence > 0 && opportunity.confidence <= 0.95);
      assert.ok(opportunity.evidence.length > 0);
    }
  });
});
