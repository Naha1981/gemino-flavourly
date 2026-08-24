import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatMenuChangeAlert, formatPromotionAlert } from './competitor-alerts.ts';
import { runCompetitorTrackingCron, type TrackingStore } from './tracking-cron.ts';
import type { MenuItem, ScrapedMenu } from './menu-scraper.ts';
import type { DetectedPromotion } from './promotion-detector.ts';

const NOW = new Date('2026-08-21T08:00:00Z');

// ---------------------------------------------------------------------------
// Alert copy (gate contract)
// ---------------------------------------------------------------------------

describe('alert copy', () => {
  test('menu change alert lists new items and price changes', () => {
    const text = formatMenuChangeAlert('The Bull Pen', {
      hasChanges: true,
      newItems: [{ name: 'Karoo lamb', priceCents: 21000 }],
      removedItems: [{ name: 'Old special', priceCents: 9900 }],
      priceChanges: [{ name: 'Ribs', fromCents: 18500, toCents: 19900 }],
    });
    assert.match(text, /^⚠️ Market Alert: The Bull Pen updated their menu\./);
    assert.match(text, /New items: Karoo lamb/);
    assert.match(text, /Removed: Old special/);
    assert.match(text, /Price changes: Ribs R185→R199/);
  });

  test('long lists are truncated with a +N more marker', () => {
    const six: MenuItem[] = Array.from({ length: 6 }, (_, i) => ({ name: `Item ${i}`, priceCents: 1000 }));
    const text = formatMenuChangeAlert('X', {
      hasChanges: true,
      newItems: six,
      removedItems: [],
      priceChanges: [],
    });
    assert.match(text, /Item 4 \(\+1 more\)/);
  });

  test('promotion alert embeds the sentence', () => {
    assert.equal(
      formatPromotionAlert('Sushi Yamu', '2-for-1 sushi Tuesdays'),
      '⚠️ Market Alert: Sushi Yamu launched a promotion: 2-for-1 sushi Tuesdays'
    );
  });
});

// ---------------------------------------------------------------------------
// Cron runner integration semantics
// ---------------------------------------------------------------------------

function menu(items: MenuItem[]): ScrapedMenu {
  return { menuUrl: 'https://x.example/menu', menuText: items.map((i) => `${i.name} R${i.priceCents / 100}`).join('\n'), items, priceRange: 'R10-R210 per person' };
}

function promo(text: string): DetectedPromotion {
  return { promotionText: text, promotionKey: text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), keyword: 'special' };
}

function memoryStore(overrides: Partial<TrackingStore> = {}) {
  const state = {
    snapshots: new Map<string, Array<{ items: MenuItem[]; at: Date }>>(),
    promotions: new Map<string, Set<string>>(),
    alerts: [] as Array<{ tenantId: string; text: string }>,
  };
  const store: TrackingStore & { state: typeof state } = {
    state,
    async findCompetitorsWithWebsites() {
      return [{ id: 'c1', tenantId: 't1', name: 'The Bull Pen', websiteUrl: 'https://bullpen.example' }];
    },
    async getLatestMenuSnapshot(competitorId) {
      const list = state.snapshots.get(competitorId) ?? [];
      return list.length > 0 ? { items: list[list.length - 1].items } : null;
    },
    async saveMenuSnapshot(input) {
      const list = state.snapshots.get(input.competitorId) ?? [];
      list.push({ items: input.items, at: input.snapshotAt });
      state.snapshots.set(input.competitorId, list);
    },
    async getRecentPromotionKeys(competitorId) {
      return state.promotions.get(competitorId) ?? new Set<string>();
    },
    async savePromotion(input) {
      const set = state.promotions.get(input.competitorId) ?? new Set<string>();
      set.add(input.promotionKey);
      state.promotions.set(input.competitorId, set);
    },
    async createAlert(tenantId, text) {
      state.alerts.push({ tenantId, text });
    },
    ...overrides,
  };
  return store;
}

describe('runCompetitorTrackingCron', () => {
  test('first-ever scrape stores the baseline with NO alert', async () => {
    const store = memoryStore();
    const summary = await runCompetitorTrackingCron(store, {
      now: NOW,
      scrapeFn: async () => menu([{ name: 'Ribs', priceCents: 18500 }]),
      detectFn: async () => [],
    });
    assert.equal(summary.snapshotsSaved, 1);
    assert.equal(summary.menuAlerts, 0);
    assert.equal(store.state.alerts.length, 0);
  });

  test('a changed menu stores a snapshot AND raises an alert', async () => {
    const store = memoryStore();
    store.state.snapshots.set('c1', [{ items: [{ name: 'Ribs', priceCents: 18500 }], at: NOW }]);

    const summary = await runCompetitorTrackingCron(store, {
      now: NOW,
      scrapeFn: async () =>
        menu([
          { name: 'Ribs', priceCents: 19900 }, // price change
          { name: 'Karoo lamb', priceCents: 21000 }, // new
        ]),
      detectFn: async () => [],
    });

    assert.equal(summary.snapshotsSaved, 1);
    assert.equal(summary.menuAlerts, 1);
    assert.equal(store.state.alerts[0].tenantId, 't1');
    assert.match(store.state.alerts[0].text, /The Bull Pen updated their menu/);
    assert.match(store.state.alerts[0].text, /Karoo lamb/);
    assert.match(store.state.alerts[0].text, /R185→R199/);
  });

  test('an unchanged menu saves nothing and alerts nobody', async () => {
    const store = memoryStore();
    store.state.snapshots.set('c1', [{ items: [{ name: 'Ribs', priceCents: 18500 }], at: NOW }]);

    const summary = await runCompetitorTrackingCron(store, {
      now: NOW,
      scrapeFn: async () => menu([{ name: 'Ribs', priceCents: 18500 }]),
      detectFn: async () => [],
    });
    assert.equal(summary.snapshotsSaved, 0);
    assert.equal(summary.menuAlerts, 0);
    assert.equal(store.state.alerts.length, 0);
  });

  test('a NEW promotion is saved and alerted; a known one is not', async () => {
    const store = memoryStore();
    store.state.promotions.set('c1', new Set(['happy hour weekdays 4pm to 6pm']));

    const summary = await runCompetitorTrackingCron(store, {
      now: NOW,
      scrapeFn: async () => menu([]),
      detectFn: async () => [promo('Happy hour weekdays 4pm to 6pm'), promo('2-for-1 burgers Mondays')],
    });

    assert.equal(summary.promotionsSaved, 1);
    assert.equal(summary.promotionAlerts, 1);
    assert.match(store.state.alerts[0].text, /launched a promotion: 2-for-1 burgers Mondays/);
  });

  test('the same promotion re-appearing tomorrow is NOT re-alerted', async () => {
    const store = memoryStore();
    const run = () =>
      runCompetitorTrackingCron(store, {
        now: NOW,
        scrapeFn: async () => menu([]),
        detectFn: async () => [promo('Happy hour weekdays 4pm to 6pm')],
      });

    const first = await run();
    const second = await run();
    assert.equal(first.promotionAlerts, 1);
    assert.equal(second.promotionAlerts, 0); // dedup via stored key
  });

  test('a failed scrape is counted and promotions still run', async () => {
    const store = memoryStore();
    const summary = await runCompetitorTrackingCron(store, {
      now: NOW,
      scrapeFn: async () => {
        throw new Error('500');
      },
      detectFn: async () => [promo('Lunch special R99')],
    });
    assert.equal(summary.skipped.scrapeFailed, 1);
    assert.equal(summary.menuScraped, 0);
    assert.equal(summary.promotionAlerts, 1);
  });

  test('a failed promotion scan is counted and does not abort', async () => {
    const store = memoryStore();
    const summary = await runCompetitorTrackingCron(store, {
      now: NOW,
      scrapeFn: async () => menu([]),
      detectFn: async () => {
        throw new Error('dns');
      },
    });
    assert.equal(summary.skipped.detectFailed, 1);
    assert.equal(summary.menuScraped, 1);
  });

  test('the per-run limit caps the sweep', async () => {
    const store = memoryStore({
      findCompetitorsWithWebsites: async () => [
        { id: 'a', tenantId: 't', name: 'A', websiteUrl: 'w' },
        { id: 'b', tenantId: 't', name: 'B', websiteUrl: 'w' },
      ],
    });
    const summary = await runCompetitorTrackingCron(store, {
      now: NOW,
      limit: 1,
      scrapeFn: async () => menu([]),
      detectFn: async () => [],
    });
    assert.equal(summary.competitorsChecked, 1);
  });
});
