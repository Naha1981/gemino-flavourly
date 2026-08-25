import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_ALERT_PREFIX,
  formatMenuChangeAlert,
  formatPromotionAlert,
  runCompetitorTrackingCron,
  type CompetitorTrackingStore,
  type MenuSnapshotRecord,
  type TrackedCompetitor,
  type TrackingDependencies,
} from './competitor-alerts.ts';
import type { MenuDiff } from './menu-scraper.ts';
import type { DetectedPromotion } from './promotion-detector.ts';
import { itemsFromText, itemsToText, menuSnapshotText } from './menu-scraper.ts';
import { newPromotions, normalizePromotion } from './promotion-detector.ts';

// -----------------------------------------------------------------------------
// Alert copy
// -----------------------------------------------------------------------------

const DIFF: MenuDiff = {
  hasChanges: true,
  newItems: [{ name: 'Veggie burger', price: 120, category: 'Mains' }],
  removedItems: [],
  priceChanges: [{ name: 'Ribeye steak', previousPrice: 280, currentPrice: 320, delta: 40 }],
};

describe('market alert copy', () => {
  test('menu change alert names the competitor, the new items and the price moves', () => {
    const text = formatMenuChangeAlert('The Bull Pen', DIFF);
    assert.equal(
      text,
      `${MARKET_ALERT_PREFIX} The Bull Pen updated their menu. ` +
        'New items: Veggie burger. Price changes: Ribeye steak R280→R320.'
    );
  });

  test('empty parts say "none" rather than dropping the sentence', () => {
    const text = formatMenuChangeAlert('Cafe X', {
      hasChanges: true,
      newItems: [],
      removedItems: [{ name: 'Lamb shank', price: 210, category: null }],
      priceChanges: [],
    });
    assert.match(text, /New items: none\./);
    assert.match(text, /Price changes: none\./);
    assert.match(text, /Removed items: Lamb shank\./);
  });

  test('removals are omitted when there are none', () => {
    assert.doesNotMatch(formatMenuChangeAlert('Cafe X', DIFF), /Removed items/);
  });

  test('long lists are truncated with a count, not dumped', () => {
    const text = formatMenuChangeAlert('Cafe X', {
      hasChanges: true,
      newItems: ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, price: 50, category: null })),
      removedItems: [],
      priceChanges: [],
    });
    assert.match(text, /New items: A, B, C \(\+2 more\)\./);
  });

  test('every market alert carries the identifying prefix', () => {
    assert.ok(formatMenuChangeAlert('X', DIFF).startsWith(MARKET_ALERT_PREFIX));
    assert.ok(formatPromotionAlert('X', 'half price wine').startsWith(MARKET_ALERT_PREFIX));
  });

  test('promotion alert quotes the offer text verbatim', () => {
    assert.equal(
      formatPromotionAlert('The Bull Pen', '  2-for-1 cocktails 16:00-18:00  '),
      `${MARKET_ALERT_PREFIX} The Bull Pen launched a promotion: 2-for-1 cocktails 16:00-18:00`
    );
  });
});

// -----------------------------------------------------------------------------
// Runner, with in-memory fakes
// -----------------------------------------------------------------------------

interface FakeOptions {
  competitors: TrackedCompetitor[];
  /** url -> scrape result (or a thrown error). */
  scrapes: Record<string, { items: Array<{ name: string; price: number; category: string | null }>; priceRange?: string | null; menuUrl?: string; diff?: MenuDiff } | Error>;
  /** url -> promotions (or a thrown error). */
  promotions: Record<string, DetectedPromotion[] | Error>;
}

function fakeStore(options: FakeOptions) {
  const snapshots = new Map<string, MenuSnapshotRecord[]>();
  const promotions = new Map<string, Array<{ promotionText: string; source: string | null }>>();
  const alerts: Array<{ tenantId: string; text: string }> = [];
  const discovered: Array<{ competitorId: string; menuUrl: string }> = [];

  const store: CompetitorTrackingStore = {
    findTrackedCompetitors: async () => options.competitors,
    getLatestMenuSnapshot: async (id) => {
      const rows = snapshots.get(id) ?? [];
      return rows.length > 0 ? rows[rows.length - 1] : null;
    },
    saveMenuSnapshot: async (id, menuUrl, menuText, priceRange) => {
      const rows = snapshots.get(id) ?? [];
      rows.push({ menuUrl, menuText, priceRange, snapshotAt: new Date() });
      snapshots.set(id, rows);
    },
    getRecentPromotions: async (id) => promotions.get(id) ?? [],
    savePromotion: async (id, promotionText, source) => {
      const rows = promotions.get(id) ?? [];
      rows.push({ promotionText, source });
      promotions.set(id, rows);
    },
    createAlert: async (tenantId, text) => {
      alerts.push({ tenantId, text });
    },
    saveDiscoveredMenuUrl: async (competitorId, menuUrl) => {
      discovered.push({ competitorId, menuUrl });
    },
  };

  return { store, snapshots, promotions, alerts, discovered };
}

function depsFor(options: FakeOptions): TrackingDependencies {
  return {
    scrapeMenuFn: async (url, scrapeOptions) => {
      const result = options.scrapes[url];
      if (result instanceof Error) throw result;
      if (!result) throw new Error(`no scrape fixture for ${url}`);
      const items = result.items;
      const previousItems = scrapeOptions?.previousItems ?? [];
      return {
        menuUrl: result.menuUrl ?? url,
        menuText: itemsToText(items),
        items,
        priceRange: result.priceRange ?? (items.length > 0 ? `R${items[0].price} per person` : null),
        diff: result.diff ?? diffOf(previousItems, items),
      };
    },
    detectPromotionsFn: async (url) => {
      const result = options.promotions[url] ?? [];
      if (result instanceof Error) throw result;
      return result;
    },
    menuSnapshotTextFn: menuSnapshotText,
    itemsFromTextFn: itemsFromText,
    newPromotionsFn: newPromotions,
  };
}

/** A real diff, computed by the shipped differ rather than hand-written. */
function diffOf(
  previous: Array<{ name: string; price: number; category: string | null }>,
  current: Array<{ name: string; price: number; category: string | null }>
): MenuDiff {
  const key = (item: { name: string }) => normalizePromotion(item.name);
  const before = new Map(previous.map((item) => [key(item), item]));
  const after = new Map(current.map((item) => [key(item), item]));

  const newItems = current.filter((item) => !before.has(key(item)));
  const removedItems = previous.filter((item) => !after.has(key(item)));
  const priceChanges = current
    .filter((item) => before.has(key(item)) && before.get(key(item))!.price !== item.price)
    .map((item) => ({
      name: item.name,
      previousPrice: before.get(key(item))!.price,
      currentPrice: item.price,
      delta: item.price - before.get(key(item))!.price,
    }));

  return {
    hasChanges: newItems.length > 0 || removedItems.length > 0 || priceChanges.length > 0,
    newItems,
    removedItems,
    priceChanges,
  };
}

const BULL_PEN: TrackedCompetitor = {
  id: 'comp-1',
  tenantId: 'tenant-1',
  name: 'The Bull Pen',
  websiteUrl: 'https://bullpen.example/',
};
const CORNER_CAFE: TrackedCompetitor = {
  id: 'comp-2',
  tenantId: 'tenant-2',
  name: 'Corner Cafe',
  websiteUrl: 'https://cornercafe.example/',
};

const BASE_MENU = [
  { name: 'Ribeye steak', price: 280, category: 'Mains' },
  { name: 'Soup of the day', price: 65, category: 'Starters' },
];

describe('market tracking cron: menu tracking', () => {
  test('a first scrape is stored as a baseline and raises no alert', async () => {
    const options: FakeOptions = {
      competitors: [BULL_PEN],
      scrapes: { 'https://bullpen.example/': { items: BASE_MENU } },
      promotions: {},
    };
    const { store, snapshots, alerts } = fakeStore(options);
    const summary = await runCompetitorTrackingCron(store, depsFor(options));

    assert.equal(summary.competitorsChecked, 1);
    assert.equal(summary.menusScraped, 1);
    assert.equal(summary.baselinesSaved, 1);
    assert.equal(summary.menuChangesDetected, 0);
    assert.equal(snapshots.get('comp-1')?.length, 1);
    assert.deepEqual(alerts, [], 'a new competitor did not rewrite its menu — no alert');
  });

  test('a changed menu stores a new snapshot and alerts the owning tenant', async () => {
    const options: FakeOptions = {
      competitors: [BULL_PEN],
      scrapes: { 'https://bullpen.example/': { items: BASE_MENU } },
      promotions: {},
    };
    const { store, snapshots, alerts } = fakeStore(options);
    const deps = depsFor(options);

    await runCompetitorTrackingCron(store, deps); // baseline

    const changedOptions: FakeOptions = {
      competitors: [BULL_PEN],
      scrapes: {
        'https://bullpen.example/': {
          items: [
            { name: 'Ribeye steak', price: 320, category: 'Mains' }, // +R40
            { name: 'Soup of the day', price: 65, category: 'Starters' },
            { name: 'Veggie burger', price: 120, category: 'Mains' }, // new
          ],
        },
      },
      promotions: {},
    };
    const summary = await runCompetitorTrackingCron(store, depsFor(changedOptions));

    assert.equal(summary.menuChangesDetected, 1);
    assert.equal(summary.snapshotsSaved, 1, 'this run stored one new snapshot');
    assert.equal(snapshots.get('comp-1')?.length, 2, 'baseline + the change');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].tenantId, 'tenant-1', 'the alert goes to the tenant that owns the competitor');
    assert.equal(
      alerts[0].text,
      `${MARKET_ALERT_PREFIX} The Bull Pen updated their menu. New items: Veggie burger. ` +
        'Price changes: Ribeye steak R280→R320.'
    );
  });

  test('an unchanged menu writes nothing and alerts nothing', async () => {
    const options: FakeOptions = {
      competitors: [BULL_PEN],
      scrapes: { 'https://bullpen.example/': { items: BASE_MENU } },
      promotions: {},
    };
    const { store, snapshots, alerts } = fakeStore(options);

    await runCompetitorTrackingCron(store, depsFor(options));
    const summary = await runCompetitorTrackingCron(store, depsFor(options));

    assert.equal(summary.menuChangesDetected, 0);
    assert.equal(snapshots.get('comp-1')?.length, 1, 'still just the baseline');
    assert.deepEqual(alerts, []);
  });

  test('an unparsable menu stores nothing, so the next scrape is not a fake rewrite', async () => {
    const options: FakeOptions = {
      competitors: [BULL_PEN],
      scrapes: { 'https://bullpen.example/': { items: [] } },
      promotions: {},
    };
    const { store, snapshots } = fakeStore(options);
    const summary = await runCompetitorTrackingCron(store, depsFor(options));

    assert.equal(summary.skipped.noMenuItems, 1);
    assert.equal(summary.baselinesSaved, 0);
    assert.equal(snapshots.get('comp-1'), undefined);
  });

  test('a failing scrape is counted and the sweep continues', async () => {
    const options: FakeOptions = {
      competitors: [BULL_PEN, CORNER_CAFE],
      scrapes: {
        'https://bullpen.example/': new Error('HTTP 502'),
        'https://cornercafe.example/': { items: BASE_MENU },
      },
      promotions: {},
    };
    const { store, snapshots } = fakeStore(options);
    const summary = await runCompetitorTrackingCron(store, depsFor(options));

    assert.equal(summary.skipped.scrapeFailed, 1);
    assert.equal(summary.competitorsChecked, 2, 'the second competitor was still processed');
    assert.equal(summary.baselinesSaved, 1);
    assert.equal(snapshots.get('comp-2')?.length, 1);
  });

  test('a discovered /menu URL is remembered for the next run', async () => {
    const options: FakeOptions = {
      competitors: [BULL_PEN],
      scrapes: {
        'https://bullpen.example/': { items: BASE_MENU, menuUrl: 'https://bullpen.example/menu' },
      },
      promotions: {},
    };
    const { store, discovered } = fakeStore(options);
    await runCompetitorTrackingCron(store, depsFor(options));
    assert.deepEqual(discovered, [{ competitorId: 'comp-1', menuUrl: 'https://bullpen.example/menu' }]);
  });
});

describe('market tracking cron: promotion tracking', () => {
  const promo = (text: string): DetectedPromotion => ({
    promotionText: text,
    keyword: 'happy hour',
    source: 'website:bullpen.example',
    context: text,
  });

  test('a new promotion is stored and alerted', async () => {
    const options: FakeOptions = {
      competitors: [BULL_PEN],
      scrapes: { 'https://bullpen.example/': { items: BASE_MENU } },
      promotions: { 'https://bullpen.example/': [promo('Happy hour 16:00-18:00')] },
    };
    const { store, promotions, alerts } = fakeStore(options);
    const summary = await runCompetitorTrackingCron(store, depsFor(options));

    assert.equal(summary.promotionsDetected, 1);
    assert.equal(summary.newPromotionsSaved, 1);
    assert.deepEqual(promotions.get('comp-1'), [
      { promotionText: 'Happy hour 16:00-18:00', source: 'website:bullpen.example' },
    ]);
    assert.equal(
      alerts.find((alert) => /launched a promotion/.test(alert.text))?.text,
      `${MARKET_ALERT_PREFIX} The Bull Pen launched a promotion: Happy hour 16:00-18:00`
    );
  });

  test('the same banner on the next run is not a new promotion', async () => {
    const options: FakeOptions = {
      competitors: [BULL_PEN],
      scrapes: { 'https://bullpen.example/': { items: BASE_MENU } },
      promotions: { 'https://bullpen.example/': [promo('Happy hour 16:00-18:00')] },
    };
    const { store, promotions, alerts } = fakeStore(options);

    await runCompetitorTrackingCron(store, depsFor(options));
    const summary = await runCompetitorTrackingCron(store, depsFor(options));

    assert.equal(summary.promotionsDetected, 1, 'still detected…');
    assert.equal(summary.newPromotionsSaved, 0, '…but not new');
    assert.equal(promotions.get('comp-1')?.length, 1);
    assert.equal(alerts.filter((alert) => /launched a promotion/.test(alert.text)).length, 1);
  });

  test('promotion alerts are capped per run, but every new one is stored', async () => {
    const many = Array.from({ length: 6 }, (_unused, i) => promo(`Happy hour deal ${i}`));
    const options: FakeOptions = {
      competitors: [BULL_PEN],
      scrapes: { 'https://bullpen.example/': { items: BASE_MENU } },
      promotions: { 'https://bullpen.example/': many },
    };
    const { store, promotions, alerts } = fakeStore(options);
    const summary = await runCompetitorTrackingCron(store, depsFor(options));

    assert.equal(summary.newPromotionsSaved, 6, 'all six are recorded in the timeline');
    assert.equal(summary.alertsCreated, 3, 'but only three reach the inbox');
    assert.equal(promotions.get('comp-1')?.length, 6);
    assert.equal(alerts.length, 3);
  });

  test('a failing promotion scan does not discard the menu work', async () => {
    const options: FakeOptions = {
      competitors: [BULL_PEN],
      scrapes: { 'https://bullpen.example/': { items: BASE_MENU } },
      promotions: { 'https://bullpen.example/': new Error('HTTP 503') },
    };
    const { store, snapshots } = fakeStore(options);
    const summary = await runCompetitorTrackingCron(store, depsFor(options));

    assert.equal(summary.skipped.promotionFailed, 1);
    assert.equal(summary.baselinesSaved, 1, 'the menu baseline was still saved');
    assert.equal(snapshots.get('comp-1')?.length, 1);
  });
});

describe('market tracking cron: isolation and limits', () => {
  test('each alert is routed to the tenant that owns the competitor', async () => {
    const options: FakeOptions = {
      competitors: [BULL_PEN, CORNER_CAFE],
      scrapes: {
        'https://bullpen.example/': { items: BASE_MENU },
        'https://cornercafe.example/': { items: [{ name: 'Toast', price: 40, category: null }] },
      },
      promotions: {
        'https://bullpen.example/': [
          { promotionText: 'Bull Pen happy hour', keyword: 'happy hour', source: 'website:bullpen.example', context: '' },
        ],
        'https://cornercafe.example/': [
          { promotionText: 'Cafe kids eat free', keyword: 'kids eat free', source: 'website:cornercafe.example', context: '' },
        ],
      },
    };
    const { store, alerts } = fakeStore(options);
    await runCompetitorTrackingCron(store, depsFor(options));

    const byTenant = new Map(alerts.map((alert) => [alert.tenantId, alert.text]));
    assert.equal(byTenant.size, 2);
    assert.match(byTenant.get('tenant-1') ?? '', /Bull Pen happy hour/);
    assert.match(byTenant.get('tenant-2') ?? '', /Cafe kids eat free/);
  });

  test('the per-run limit is honoured', async () => {
    const competitors = Array.from({ length: 10 }, (_unused, i) => ({
      id: `comp-${i}`,
      tenantId: 'tenant-1',
      name: `Place ${i}`,
      websiteUrl: `https://place${i}.example/`,
    }));
    const options: FakeOptions = {
      competitors,
      scrapes: Object.fromEntries(competitors.map((c) => [c.websiteUrl as string, { items: BASE_MENU }])),
      promotions: {},
    };
    const { store } = fakeStore(options);
    const summary = await runCompetitorTrackingCron(store, depsFor(options), { limit: 3 });
    assert.equal(summary.competitorsChecked, 3);
    assert.equal(summary.baselinesSaved, 3);
  });

  test('a competitor with no website is skipped, not failed', async () => {
    const options: FakeOptions = {
      competitors: [{ id: 'comp-9', tenantId: 'tenant-1', name: 'Manual only', websiteUrl: null }],
      scrapes: {},
      promotions: {},
    };
    const { store } = fakeStore(options);
    const summary = await runCompetitorTrackingCron(store, depsFor(options));
    assert.equal(summary.skipped.noWebsite, 1);
    assert.equal(summary.competitorsChecked, 1);
  });

  test('a store failure returns a summary instead of throwing', async () => {
    const store: CompetitorTrackingStore = {
      findTrackedCompetitors: async () => {
        throw new Error('database down');
      },
      getLatestMenuSnapshot: async () => null,
      saveMenuSnapshot: async () => undefined,
      getRecentPromotions: async () => [],
      savePromotion: async () => undefined,
      createAlert: async () => undefined,
    };
    const summary = await runCompetitorTrackingCron(store, {
      scrapeMenuFn: async () => {
        throw new Error('should not be reached');
      },
      detectPromotionsFn: async () => [],
      menuSnapshotTextFn: menuSnapshotText,
      itemsFromTextFn: itemsFromText,
      newPromotionsFn: newPromotions,
    });
    assert.equal(summary.skipped.failed, 1);
    assert.equal(summary.competitorsChecked, 0);
  });

  test('the sweep surfaces samples for the cron log', async () => {
    const options: FakeOptions = {
      competitors: [BULL_PEN],
      scrapes: { 'https://bullpen.example/': { items: BASE_MENU } },
      promotions: {
        'https://bullpen.example/': [
          { promotionText: 'Happy hour', keyword: 'happy hour', source: 'website:bullpen.example', context: '' },
        ],
      },
    };
    const { store } = fakeStore(options);
    const summary = await runCompetitorTrackingCron(store, depsFor(options));
    assert.deepEqual(summary.samples, [
      { competitorId: 'comp-1', name: 'The Bull Pen', menuChanged: false, newPromotions: 1 },
    ]);
  });
});
