import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  averageMenuPrice,
  buildPositioningReport,
  priceBandOf,
  pricePercentile,
  type PositioningCompetitor,
  type PositioningTenant,
} from './positioning-analyzer.ts';
import type { MenuItem } from './menu-scraper.ts';

const NOW = new Date('2026-08-25T08:00:00.000Z');

function items(...entries: Array<[string, number]>): MenuItem[] {
  return entries.map(([name, price]) => ({ name, price, category: null }));
}

function tenant(overrides: Partial<PositioningTenant> = {}): PositioningTenant {
  return {
    name: 'My Place',
    menuItems: items(['Ribeye steak', 280], ['Burger', 120], ['Soup of the day', 65]), // average 155
    menuSource: 'menu_text',
    googleRating: 4.5,
    reviewCount: 100,
    priceLevel: 2,
    ...overrides,
  };
}

function competitor(id: string, overrides: Partial<PositioningCompetitor> = {}): PositioningCompetitor {
  return {
    id,
    name: overrides.name ?? `Competitor ${id}`,
    distanceKm: overrides.distanceKm === undefined ? 2 : overrides.distanceKm,
    menuItems: overrides.menuItems ?? [],
    googleRating: overrides.googleRating ?? null,
    reviewCount: overrides.reviewCount ?? null,
    priceLevel: overrides.priceLevel ?? null,
  };
}

/** The fixture used across the assertions below. */
function fleet(): PositioningCompetitor[] {
  return [
    competitor('a', {
      name: 'The Grill Room',
      menuItems: items(['Ribeye steak', 300], ['Wine', 200]), // average 250
      googleRating: 4.8,
      reviewCount: 500,
      distanceKm: 1.2,
    }),
    competitor('b', {
      name: 'Corner Cafe',
      menuItems: items(['Toast', 40], ['Soup of the day', 60]), // average 50
      googleRating: 4.2,
      reviewCount: 80,
      distanceKm: 0.8,
    }),
    competitor('c', {
      name: 'Pizza Place',
      menuItems: items(['Margherita pizza', 90]), // average 90
      googleRating: null,
      distanceKm: 3.4,
    }),
    competitor('d', {
      name: 'No Menu Scraped',
      menuItems: [],
      googleRating: 4.5,
      reviewCount: 200,
      distanceKm: null,
    }),
  ];
}

describe('positioning: building blocks', () => {
  test('average menu price ignores unpriced items', () => {
    assert.equal(averageMenuPrice(items(['A', 100], ['B', 200])), 150);
    assert.equal(averageMenuPrice([]), null);
    assert.equal(averageMenuPrice([{ name: 'Free water', price: 0, category: null }]), null);
  });

  test('percentile is the share of the market that is cheaper', () => {
    const standings = [{ average: 50 }, { average: 90 }, { average: 155 }, { average: 250 }];
    assert.equal(pricePercentile(155, standings), 50);
    assert.equal(pricePercentile(10, standings), 0);
    assert.equal(pricePercentile(999, standings), 100, 'everything is cheaper than that');
    assert.equal(pricePercentile(100, [{ average: null }]), 0);
  });

  test('bands follow the documented thirds', () => {
    assert.equal(priceBandOf(0), 'budget');
    assert.equal(priceBandOf(32), 'budget');
    assert.equal(priceBandOf(33), 'mid-range');
    assert.equal(priceBandOf(66), 'mid-range');
    assert.equal(priceBandOf(67), 'premium');
    assert.equal(priceBandOf(100), 'premium');
    assert.equal(priceBandOf(null), 'unknown');
  });
});

describe('positioning: the full report', () => {
  const report = buildPositioningReport({ tenant: tenant(), competitors: fleet() }, { now: NOW });

  test('it is deterministic and timestamped from the injected clock', () => {
    assert.equal(report.generatedAt, NOW.toISOString());
    const again = buildPositioningReport({ tenant: tenant(), competitors: fleet() }, { now: NOW });
    assert.deepEqual(again, report);
  });

  test('price positioning places the tenant in the right band', () => {
    assert.equal(report.price.average, 155);
    assert.equal(report.price.band, 'mid-range');
    assert.equal(report.price.percentile, 50);
    assert.deepEqual(
      report.price.standings.map((entry) => [entry.name, entry.average, entry.isTenant]),
      [
        ['Corner Cafe', 50, false],
        ['Pizza Place', 90, false],
        ['My Place', 155, true],
        ['The Grill Room', 250, false],
        ['No Menu Scraped', null, false],
      ],
      'cheapest first, unpriced last'
    );
    assert.match(report.price.summary, /averages R155 per dish/);
    assert.match(report.price.summary, /mid-range/);
    assert.match(report.price.summary, /cheapest R50, dearest R250/);
  });

  test('rating ranking counts the tenant among the field and breaks ties on review count', () => {
    assert.equal(report.rating.rank, 3);
    assert.equal(report.rating.total, 4, 'the unrated competitor is not in the ranking');
    assert.equal(report.rating.percentile, 33);
    assert.deepEqual(
      report.rating.standings.map((entry) => [entry.name, entry.rating, entry.reviewCount]),
      [
        ['The Grill Room', 4.8, 500],
        ['No Menu Scraped', 4.5, 200],
        ['My Place', 4.5, 100],
        ['Corner Cafe', 4.2, 80],
        ['Pizza Place', null, null],
      ]
    );
    assert.equal(report.rating.summary, 'You rank 3rd of 4 on Google rating (4.5★ vs the local best of 4.8★).');
  });

  test('menu overlap is measured against each competitor menu', () => {
    // (50% + 50% + 0%) / 3 measurable competitors — the unscraped one is
    // excluded rather than dragging the average down as a 0%.
    assert.equal(report.menu_overlap.average_percent, 33);
    const byName = new Map(report.menu_overlap.per_competitor.map((entry) => [entry.competitorName, entry]));

    assert.equal(byName.get('The Grill Room')?.sharedItemCount, 1);
    assert.deepEqual(byName.get('The Grill Room')?.sharedItems, ['ribeye steak']);
    assert.equal(byName.get('The Grill Room')?.overlapPercent, 50);
    assert.equal(byName.get('Corner Cafe')?.overlapPercent, 50);
    assert.equal(byName.get('Pizza Place')?.overlapPercent, 0);
    assert.equal(byName.get('No Menu Scraped')?.overlapPercent, null, 'nothing scraped means nothing to measure');
    assert.match(report.menu_overlap.summary, /cover 33% of a competitor menu/);
  });

  test('overlap matching ignores case and punctuation', () => {
    const report2 = buildPositioningReport(
      {
        tenant: tenant({ menuItems: items(['SOUP OF THE DAY!', 65]) }),
        competitors: [competitor('a', { menuItems: items(['soup of the day', 70]) })],
      },
      { now: NOW }
    );
    assert.equal(report2.menu_overlap.per_competitor[0].overlapPercent, 100);
  });

  test('unique offerings are the dishes nobody else has', () => {
    assert.deepEqual(report.unique_offerings.items, ['Burger']);
    assert.equal(report.unique_offerings.count, 1);
    assert.match(report.unique_offerings.summary, /1 of your 3 dishes are not on any competitor menu nearby/);
  });

  test('the headline summarizes all three positions', () => {
    assert.equal(report.headline, 'R155 average dish price (mid-range) · 3rd of 4 on Google rating · 1 unique dish');
  });

  test('the tenant block records where the menu came from', () => {
    assert.equal(report.tenant.menu_source, 'menu_text');
    assert.equal(report.tenant.menu_items, 3);
    assert.equal(report.tenant.google_rating, 4.5);
    assert.equal(report.competitors_analysed, 4);
  });
});

describe('positioning: honest reporting when data is missing', () => {
  test('no tenant menu yields an unknown band and an instruction, not a guess', () => {
    const report = buildPositioningReport(
      { tenant: tenant({ menuItems: [], menuSource: 'none', googleRating: null, reviewCount: null }), competitors: fleet() },
      { now: NOW }
    );
    assert.equal(report.price.band, 'unknown');
    assert.equal(report.price.average, null);
    assert.equal(report.price.percentile, null);
    assert.match(report.price.summary, /Add your menu in Settings/);
    assert.equal(report.rating.rank, null);
    assert.match(report.rating.summary, /No Google rating on record/);
    assert.equal(report.menu_overlap.average_percent, null);
    assert.match(report.menu_overlap.summary, /Add your menu in Settings/);
    assert.deepEqual(report.unique_offerings.items, []);
  });

  test('no competitors yet is reported as such rather than as dominance', () => {
    const report = buildPositioningReport({ tenant: tenant(), competitors: [] }, { now: NOW });
    assert.equal(report.competitors_analysed, 0);
    assert.equal(report.price.percentile, null);
    assert.equal(report.price.band, 'unknown');
    assert.match(report.price.summary, /no competitor menu with prices was scraped yet/);
    assert.equal(report.rating.total, 1);
    assert.match(report.rating.summary, /no competitor rating is stored to rank against/);
    assert.equal(report.menu_overlap.average_percent, null);
    assert.match(report.unique_offerings.summary, /No competitors tracked yet/);
  });

  test('a menu with no prices is not treated as free', () => {
    const report = buildPositioningReport(
      {
        tenant: tenant({
          menuItems: [
            { name: 'Steak', price: 0, category: null },
            { name: 'Chips', price: 0, category: null },
          ],
        }),
        competitors: fleet(),
      },
      { now: NOW }
    );
    assert.equal(report.price.average, null);
    assert.match(report.price.summary, /no prices, so no price position could be computed/);
  });

  test('an identical menu to the market reads as interchangeable', () => {
    const shared = items(['Ribeye steak', 280], ['Burger', 120]);
    const report = buildPositioningReport(
      {
        tenant: tenant({ menuItems: shared }),
        competitors: [competitor('a', { menuItems: shared }), competitor('b', { menuItems: shared })],
      },
      { now: NOW }
    );
    assert.equal(report.menu_overlap.average_percent, 100);
    assert.match(report.menu_overlap.summary, /close to interchangeable/);
    assert.deepEqual(report.unique_offerings.items, []);
    assert.match(report.unique_offerings.summary, /edge has to be price, service or reputation/);
  });

  test('ordinals read correctly at the boundaries', () => {
    const fixture = (competitorCount: number, tenantRating: number) =>
      buildPositioningReport(
        {
          tenant: tenant({ googleRating: tenantRating }),
          competitors: Array.from({ length: competitorCount }, (_unused, i) =>
            competitor(`c${i}`, { googleRating: 5, reviewCount: 10 + i })
          ),
        },
        { now: NOW }
      );

    assert.match(fixture(3, 4.9).rating.summary, /You rank 4th of 4/);
    assert.match(fixture(1, 4.9).rating.summary, /You rank 2nd of 2/);
    assert.match(fixture(0, 4.9).rating.summary, /no competitor rating is stored/);
    // 10 competitors rated 5.0 above a 4.5 tenant -> 11th of 11, not "11st".
    assert.match(fixture(10, 4.5).rating.summary, /You rank 11th of 11/);
    assert.match(fixture(20, 4.5).rating.summary, /You rank 21st of 21/);
    assert.match(fixture(21, 4.5).rating.summary, /You rank 22nd of 22/);
  });
});
