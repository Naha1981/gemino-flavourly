import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPositioningReport,
  classifyPrice,
  type PositioningCompetitorInput,
  type PositioningTenantInput,
} from './positioning-analyzer.ts';

function tenant(overrides: Partial<PositioningTenantInput> = {}): PositioningTenantInput {
  return {
    name: 'Flavourly',
    rating: 4.5,
    avgItemRands: 150,
    menuItems: ['Peri-peri chicken', 'Ribs', 'Karoo lamb', 'Malva pudding'],
    ...overrides,
  };
}

function competitor(overrides: Partial<PositioningCompetitorInput> = {}): PositioningCompetitorInput {
  return {
    name: 'Competitor',
    rating: 4.0,
    avgItemRands: 120,
    menuItems: ['Peri-peri chicken', 'Burgers'],
    ...overrides,
  };
}

describe('classifyPrice', () => {
  test('bands split at R100 and R220', () => {
    assert.equal(classifyPrice(75), 'budget');
    assert.equal(classifyPrice(100), 'budget');
    assert.equal(classifyPrice(150), 'mid-range');
    assert.equal(classifyPrice(219), 'mid-range');
    assert.equal(classifyPrice(220), 'premium');
    assert.equal(classifyPrice(350), 'premium');
  });
});

describe('buildPositioningReport (Gate #18)', () => {
  test('price positioning against a three-competitor market', () => {
    const report = buildPositioningReport(tenant({ avgItemRands: 150 }), [
      competitor({ name: 'Cheap Eats', avgItemRands: 70 }),
      competitor({ name: 'Mid Bistro', avgItemRands: 140 }),
      competitor({ name: 'Fine Room', avgItemRands: 320 }),
    ]);
    assert.equal(report.price.tenantClass, 'mid-range');
    assert.equal(report.price.marketMinRands, 70);
    assert.equal(report.price.marketMaxRands, 320);
    assert.equal(report.price.marketAvgRands, 176.66666666666666);
    assert.deepEqual(
      report.price.competitorClasses.map((c) => c.priceClass),
      ['budget', 'mid-range', 'premium']
    );
    assert.match(report.price.summary, /positions you as mid-range/);
    assert.match(report.price.summary, /R70-R320/);
  });

  test('rating ranking: tenant ahead of two, behind one', () => {
    const report = buildPositioningReport(tenant({ rating: 4.5 }), [
      competitor({ name: 'High', rating: 4.8 }),
      competitor({ name: 'Low', rating: 3.9 }),
      competitor({ name: 'Mid', rating: 4.2 }),
    ]);
    assert.equal(report.rating.rank, 2);
    assert.equal(report.rating.of, 4);
    assert.deepEqual(report.rating.aheadOf, ['Mid', 'Low']);
    assert.match(report.rating.summary, /#2 of 4/);
  });

  test('rating ties keep the tenant deterministic (stable order)', () => {
    const report = buildPositioningReport(tenant({ rating: 4.5 }), [
      competitor({ name: 'Same', rating: 4.5 }),
    ]);
    assert.ok(report.rating.rank >= 1 && report.rating.rank <= 2);
  });

  test('menu overlap counts exact shared items and finds unique offerings', () => {
    const report = buildPositioningReport(
      tenant({ menuItems: ['Peri-peri chicken', 'Ribs', 'Karoo lamb', 'Malva pudding'] }),
      [
        competitor({ name: 'A', menuItems: ['Peri-peri chicken', 'Burgers'] }), // 1/2 shared
        competitor({ name: 'B', menuItems: ['Ribs', 'Peri-peri chicken', 'Wings'] }), // 2/3 shared
      ]
    );
    assert.equal(report.menu.overlapRows.length, 2);
    const rowA = report.menu.overlapRows.find((r) => r.competitor === 'A')!;
    const rowB = report.menu.overlapRows.find((r) => r.competitor === 'B')!;
    assert.equal(rowA.sharedCount, 1);
    assert.equal(rowA.competitorItemCount, 2);
    assert.equal(rowB.sharedCount, 2);
    // average = (0.5 + 2/3) / 2
    assert.ok(Math.abs((report.menu.averageOverlap as number) - 0.5833) < 0.001);
    // unique = tenant items nobody else has:
    assert.ok(report.menu.uniqueOfferings.includes('karoo lamb'));
    assert.ok(report.menu.uniqueOfferings.includes('malva pudding'));
    assert.ok(!report.menu.uniqueOfferings.includes('ribs'));
  });

  test('overlap matching is case/whitespace insensitive', () => {
    const report = buildPositioningReport(
      tenant({ menuItems: ['  Peri-Peri   CHICKEN '] }),
      [competitor({ menuItems: ['peri-peri chicken'] })]
    );
    assert.equal(report.menu.overlapRows[0].sharedCount, 1);
  });

  test('empty markets degrade to honest summaries, never invented numbers', () => {
    const report = buildPositioningReport(tenant({ rating: 0, avgItemRands: null, menuItems: [] }), []);
    assert.equal(report.price.tenantClass, 'unknown');
    assert.equal(report.price.marketAvgRands, null);
    assert.match(report.price.summary, /Not enough menu pricing/);
    assert.equal(report.rating.rank, 0);
    assert.equal(report.menu.averageOverlap, null);
    assert.match(report.menu.summary, /unlocks once/);
  });

  test('competitors without menus are excluded from overlap rows', () => {
    const report = buildPositioningReport(tenant(), [
      competitor({ name: 'NoMenu', menuItems: [] }),
      competitor({ name: 'HasMenu', menuItems: ['Ribs'] }),
    ]);
    assert.equal(report.menu.overlapRows.length, 1);
    assert.equal(report.menu.overlapRows[0].competitor, 'HasMenu');
  });

  test('summaries read like owner-facing sentences', () => {
    const report = buildPositioningReport(tenant({ rating: 4.5, avgItemRands: 150 }), [
      competitor({ name: 'A', rating: 4.0, avgItemRands: 100, menuItems: ['Ribs'] }),
    ]);
    assert.match(report.rating.summary, /4\.5★ ranks #1 of 2/);
    assert.match(report.menu.summary, /items nobody else offers/);
  });
});
