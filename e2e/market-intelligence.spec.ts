import { test, expect } from '@playwright/test';
import { discoverCompetitors } from '../apps/main/lib/market/geolocation';
import { itemsFromText, menuSnapshotText, scrapeMenu } from '../apps/main/lib/market/menu-scraper';
import { detectPromotions, newPromotions } from '../apps/main/lib/market/promotion-detector';
import {
  MARKET_ALERT_PREFIX,
  formatMenuChangeAlert,
  formatPromotionAlert,
  runCompetitorTrackingCron,
  type CompetitorTrackingStore,
  type MenuSnapshotRecord,
  type TrackingDependencies,
  type TrackedCompetitor,
} from '../apps/main/lib/market/competitor-alerts';
import { analyzeOpportunities } from '../apps/main/lib/market/opportunity-analyzer';
import { buildPositioningReport } from '../apps/main/lib/market/positioning-analyzer';
import { diffMenus } from '../apps/main/lib/market/menu-scraper';

const BASE_URL = process.env.BASE_URL || 'https://gemino-flavourly-whatsapp.vercel.app';

/**
 * Gates #15-#18 — Local Market Intelligence Engine, end to end.
 *
 * Two layers, because they answer different questions:
 *
 *   1. DEPLOYED CONTRACT (needs a running deployment, no credentials): the
 *      market dashboards are auth-gated, every market API 401s without a
 *      signed-in tenant, and the tracking cron rejects callers without the
 *      CRON_SECRET bearer. These run against any preview.
 *
 *   2. FULL WORKFLOW (runs anywhere): the actual shipped modules wired
 *      together — discover competitors from a Places fixture, scrape their
 *      menus, diff against the stored snapshot, detect a promotion, raise the
 *      alert, then feed the result into opportunity detection and positioning.
 *      The only things faked are the network (fixtures) and Postgres (an
 *      in-memory store), so this exercises the real pipeline rather than a
 *      re-implementation of it.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ORIGIN = { latitude: -33.9249, longitude: 18.4241 }; // Cape Town

const GEOCODE_BODY = {
  status: 'OK',
  results: [
    {
      formatted_address: '12 Loop St, Cape Town, 8001',
      // The Geocoding API returns lat/lng (Places returns latitude/longitude);
      // the fixture must match the endpoint it stands in for.
      geometry: { location: { lat: TENANT_ORIGIN.latitude, lng: TENANT_ORIGIN.longitude }, location_type: 'ROOFTOP' },
    },
  ],
};

const NEARBY_BODY = {
  places: [
    {
      id: 'ChIJ-bullpen',
      displayName: { text: 'The Bull Pen' },
      formattedAddress: '5 Bree St, Cape Town',
      location: { latitude: TENANT_ORIGIN.latitude + 0.01, longitude: TENANT_ORIGIN.longitude },
      rating: 4.4,
      userRatingCount: 210,
      priceLevel: 'PRICE_LEVEL_MODERATE',
      primaryType: 'steak_house',
      types: ['steak_house', 'restaurant'],
      websiteUri: 'https://bullpen.example/',
      nationalPhoneNumber: '021 555 0100',
      servesBrunch: false,
    },
    {
      id: 'ChIJ-corner',
      displayName: { text: 'Corner Cafe' },
      formattedAddress: '9 Loop St, Cape Town',
      location: { latitude: TENANT_ORIGIN.latitude + 0.02, longitude: TENANT_ORIGIN.longitude },
      rating: 4.7,
      userRatingCount: 88,
      priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
      primaryType: 'cafe',
      types: ['cafe', 'restaurant'],
      websiteUri: 'https://cornercafe.example/',
    },
  ],
};

function menuPage(items: Array<[string, number]>, promo?: string): string {
  const rows = items.map(([name, price]) => `<li>${name} R${price}</li>`).join('');
  return `<html><body>${promo ? `<div class="banner">${promo}</div>` : ''}<h2>Mains</h2><ul>${rows}</ul></body></html>`;
}

const V1_MENU: Array<[string, number]> = [
  ['Ribeye steak', 280],
  ['Veggie burger', 120],
  ['Soup of the day', 65],
];
const V2_MENU: Array<[string, number]> = [
  ['Ribeye steak', 320], // repriced
  ['Veggie burger', 120],
  ['Malva pudding', 55], // new; the soup is gone
];

// ---------------------------------------------------------------------------
// 1. Deployed contract
// ---------------------------------------------------------------------------

test.describe('Market Intelligence (Gates #15-#18): deployed contract', () => {
  test('market dashboards are auth-gated', async ({ page }) => {
    for (const path of ['/dashboard/market/competitors', '/dashboard/market/opportunities', '/dashboard/market/positioning']) {
      await page.goto(path);
      await page.waitForURL(/\/sign-in/);
      await expect(page.locator('body')).not.toContainText('Internal Server Error');
    }
  });

  test('market APIs are auth-gated (401 when unauthenticated)', async ({ request }) => {
    for (const path of [
      '/api/market/competitors',
      '/api/market/alerts',
      '/api/market/opportunities',
      '/api/market/positioning',
      '/api/market/competitors/some-id/menu-history',
      '/api/market/competitors/some-id/promotions',
    ]) {
      const res = await request.get(`${BASE_URL}${path}`, { maxRedirects: 0 });
      expect([401, 403]).toContain(res.status());
    }
  });

  test('market mutations are auth-gated too', async ({ request }) => {
    const add = await request.post(`${BASE_URL}/api/market/competitors`, {
      data: { name: 'Ghost Diner', website_url: 'https://ghost.example' },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(add.status());

    const discover = await request.post(`${BASE_URL}/api/market/competitors/discover`, {
      data: { address: '12 Loop St, Cape Town' },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(discover.status());

    const analyze = await request.post(`${BASE_URL}/api/market/opportunities/analyze`, { maxRedirects: 0 });
    expect([401, 403]).toContain(analyze.status());

    const patch = await request.patch(`${BASE_URL}/api/market/opportunities/some-id`, {
      data: { addressed: true },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(patch.status());
  });

  test('the tracking cron rejects callers without the bearer secret', async ({ request }) => {
    const anonymous = await request.get(`${BASE_URL}/api/cron/track-competitors`, { maxRedirects: 0 });
    expect(anonymous.status()).toBe(401);

    const wrongSecret = await request.get(`${BASE_URL}/api/cron/track-competitors`, {
      headers: { Authorization: 'Bearer definitely-not-the-secret' },
      maxRedirects: 0,
    });
    expect(wrongSecret.status()).toBe(401);

    // Query-string credentials must not be accepted either.
    const querySecret = await request.get(`${BASE_URL}/api/cron/track-competitors?key=whatever`, { maxRedirects: 0 });
    expect(querySecret.status()).toBe(401);

    const body = await anonymous.json().catch(() => ({}));
    expect(body).not.toHaveProperty('competitorsChecked');
  });

  test('the tracking cron accepts the CRON_SECRET bearer and runs', async ({ request }) => {
    const secret = process.env.E2E_CRON_SECRET;
    test.skip(!secret, 'Set E2E_CRON_SECRET to exercise the guarded cron boundary.');

    const res = await request.get(`${BASE_URL}/api/cron/track-competitors`, {
      headers: { Authorization: `Bearer ${secret}` },
      maxRedirects: 0,
    });
    expect(res.status()).not.toBe(401);
    expect(res.status()).not.toBe(403);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('ok', true);
  });
});

// ---------------------------------------------------------------------------
// 2. Full workflow, real modules, faked network + database
// ---------------------------------------------------------------------------

interface MemoryStore extends CompetitorTrackingStore {
  competitors: TrackedCompetitor[];
  snapshots: Map<string, MenuSnapshotRecord[]>;
  promotions: Map<string, Array<{ promotionText: string; source: string | null }>>;
  alerts: Array<{ tenantId: string; text: string }>;
}

function memoryStore(competitors: TrackedCompetitor[]): MemoryStore {
  const store: MemoryStore = {
    competitors,
    snapshots: new Map(),
    promotions: new Map(),
    alerts: [],
    findTrackedCompetitors: async () => store.competitors,
    getLatestMenuSnapshot: async (id) => {
      const rows = store.snapshots.get(id) ?? [];
      return rows.length > 0 ? rows[rows.length - 1] : null;
    },
    saveMenuSnapshot: async (id, menuUrl, menuText, priceRange) => {
      const rows = store.snapshots.get(id) ?? [];
      rows.push({ menuUrl, menuText, priceRange, snapshotAt: new Date() });
      store.snapshots.set(id, rows);
    },
    getRecentPromotions: async (id) => store.promotions.get(id) ?? [],
    savePromotion: async (id, promotionText, source) => {
      const rows = store.promotions.get(id) ?? [];
      rows.push({ promotionText, source });
      store.promotions.set(id, rows);
    },
    createAlert: async (tenantId, text) => {
      store.alerts.push({ tenantId, text });
    },
  };
  return store;
}

function fetchStub(routes: Record<string, { body: unknown; contentType?: string }>) {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    const isJson = typeof route.body === 'object';
    return new Response(isJson ? JSON.stringify(route.body) : String(route.body), {
      status: 200,
      headers: { 'Content-Type': route.contentType ?? (isJson ? 'application/json' : 'text/html; charset=utf-8') },
    });
  };
  return impl as unknown as typeof fetch;
}

const TRACKING_DEPS: TrackingDependencies = {
  scrapeMenuFn: scrapeMenu,
  detectPromotionsFn: detectPromotions,
  menuSnapshotTextFn: menuSnapshotText,
  itemsFromTextFn: itemsFromText,
  newPromotionsFn: newPromotions,
};

test.describe('Market Intelligence (Gates #15-#18): full workflow', () => {
  test('discover -> baseline -> menu change -> promotion -> alert -> gaps -> positioning', async () => {
    // ── #15 discover competitors within 5km ─────────────────────────────────
    const geocodeFetch = fetchStub({
      'https://maps.googleapis.com/maps/api/geocode/json?address=12+Loop+St%2C+Cape+Town&key=test-key': {
        body: GEOCODE_BODY,
      },
      'https://places.googleapis.com/v1/places:searchNearby': { body: NEARBY_BODY },
    });

    const discovery = await discoverCompetitors('12 Loop St, Cape Town', {
      apiKey: 'test-key',
      radiusKm: 5,
      includeMealFlags: true,
      fetchImpl: geocodeFetch,
    });

    expect(discovery.radiusKm).toBe(5);
    expect(discovery.restaurants.map((restaurant) => restaurant.name)).toEqual(['The Bull Pen', 'Corner Cafe']);
    expect(discovery.restaurants[0].distanceKm).toBeCloseTo(1.1, 1);
    expect(discovery.restaurants[0].websiteUrl).toBe('https://bullpen.example/');
    expect(discovery.restaurants[0].priceLevel).toBe(2);
    expect(discovery.restaurants[1].googlePlaceId).toBe('ChIJ-corner');

    const tracked: TrackedCompetitor[] = discovery.restaurants.map((restaurant) => ({
      id: restaurant.googlePlaceId,
      tenantId: 'tenant-1',
      name: restaurant.name,
      websiteUrl: restaurant.websiteUrl,
    }));
    const store = memoryStore(tracked);

    // ── #16 first sweep: baselines, no alerts ───────────────────────────────
    const dayOne = fetchStub({
      'https://bullpen.example/': { body: menuPage(V1_MENU) },
      'https://cornercafe.example/': { body: menuPage([['Toast', 40], ['Soup of the day', 60]]) },
    });
    const firstSweep = await runCompetitorTrackingCron(
      store,
      { ...TRACKING_DEPS, scrapeMenuFn: (url, options) => scrapeMenu(url, { ...options, fetchImpl: dayOne }), detectPromotionsFn: (url) => detectPromotions(url, { fetchImpl: dayOne }) },
      { now: new Date('2026-08-25T08:00:00.000Z') }
    );

    expect(firstSweep.competitorsChecked).toBe(2);
    expect(firstSweep.baselinesSaved).toBe(2);
    expect(firstSweep.menuChangesDetected).toBe(0);
    expect(store.alerts).toEqual([], 'a baseline is not a menu change');

    // ── #16 second sweep: a repriced dish, a new one, and a promotion ───────
    const dayTwo = fetchStub({
      'https://bullpen.example/': {
        body: menuPage(V2_MENU, 'HAPPY HOUR: 2-for-1 cocktails 16:00-18:00'),
      },
      'https://cornercafe.example/': { body: menuPage([['Toast', 40], ['Soup of the day', 60]]) },
    });
    const secondSweep = await runCompetitorTrackingCron(
      store,
      { ...TRACKING_DEPS, scrapeMenuFn: (url, options) => scrapeMenu(url, { ...options, fetchImpl: dayTwo }), detectPromotionsFn: (url) => detectPromotions(url, { fetchImpl: dayTwo }) },
      { now: new Date('2026-08-26T08:00:00.000Z') }
    );

    expect(secondSweep.menuChangesDetected).toBe(1, 'only The Bull Pen changed its menu');
    expect(secondSweep.newPromotionsSaved).toBe(1);
    expect(store.alerts.length).toBe(2, 'one menu alert + one promotion alert');

    const [menuAlert, promoAlert] = store.alerts;
    expect(menuAlert.tenantId).toBe('tenant-1');
    expect(menuAlert.text.startsWith(MARKET_ALERT_PREFIX)).toBe(true);
    expect(menuAlert.text).toBe(formatMenuChangeAlert('The Bull Pen', diffMenus(itemsFromText(store.snapshots.get('ChIJ-bullpen')?.[0].menuText ?? null), itemsFromText(store.snapshots.get('ChIJ-bullpen')?.[1].menuText ?? null))));
    expect(menuAlert.text).toContain('New items: Malva pudding');
    expect(menuAlert.text).toContain('Ribeye steak R280→R320');
    expect(menuAlert.text).toContain('Removed items: Soup of the day');
    expect(promoAlert.text).toBe(formatPromotionAlert('The Bull Pen', 'HAPPY HOUR: 2-for-1 cocktails 16:00-18:00'));

    // ── #16 a third sweep with no changes raises nothing new ────────────────
    const thirdSweep = await runCompetitorTrackingCron(
      store,
      { ...TRACKING_DEPS, scrapeMenuFn: (url, options) => scrapeMenu(url, { ...options, fetchImpl: dayTwo }), detectPromotionsFn: (url) => detectPromotions(url, { fetchImpl: dayTwo }) },
      { now: new Date('2026-08-27T08:00:00.000Z') }
    );
    expect(thirdSweep.menuChangesDetected).toBe(0);
    expect(thirdSweep.newPromotionsSaved).toBe(0, 'the same banner is not a new promotion');
    expect(store.alerts.length).toBe(2);

    // ── #17 the same data yields a market gap ───────────────────────────────
    const opportunities = analyzeOpportunities({
      tenant: {
        name: 'My Place',
        menuText: 'Sunday brunch: eggs benedict R95\nVegan bobotie R120',
        menuItems: [
          { name: 'Eggs benedict', price: 95, category: null },
          { name: 'Vegan bobotie', price: 120, category: null },
        ],
        placeTypes: [],
        serves: ['brunch'],
        openingHours: 'Mon-Sun 08:00-22:00',
        priceLevel: null,
      },
      competitors: discovery.restaurants.map((restaurant) => ({
        id: restaurant.googlePlaceId,
        name: restaurant.name,
        distanceKm: restaurant.distanceKm,
        menuItems: itemsFromText(store.snapshots.get(restaurant.googlePlaceId)?.[0]?.menuText ?? null),
        menuText: store.snapshots.get(restaurant.googlePlaceId)?.[0]?.menuText ?? null,
        priceRange: null,
        placeTypes: restaurant.types,
        serves: restaurant.serves,
        priceLevel: restaurant.priceLevel,
        rating: restaurant.rating,
      })),
      radiusKm: 5,
    });

    const brunchGap = opportunities.find((opportunity) => opportunity.key === 'meal_gap:brunch');
    expect(brunchGap).toBeTruthy();
    expect(brunchGap?.confidence).toBeGreaterThan(0.5);
    expect(brunchGap?.evidence[0]).toContain('within 5km');

    // ── #18 and the positioning report from the same competitor set ─────────
    const report = buildPositioningReport(
      {
        tenant: {
          name: 'My Place',
          menuItems: [
            { name: 'Eggs benedict', price: 95, category: null },
            { name: 'Vegan bobotie', price: 120, category: null },
          ],
          menuSource: 'menu_text',
          googleRating: 4.6,
          reviewCount: 140,
          priceLevel: null,
        },
        competitors: discovery.restaurants.map((restaurant) => ({
          id: restaurant.googlePlaceId,
          name: restaurant.name,
          distanceKm: restaurant.distanceKm,
          menuItems: itemsFromText(store.snapshots.get(restaurant.googlePlaceId)?.[0]?.menuText ?? null),
          googleRating: restaurant.rating,
          reviewCount: restaurant.reviewCount,
          priceLevel: restaurant.priceLevel,
        })),
      },
      { now: new Date('2026-08-27T08:00:00.000Z') }
    );

    expect(report.competitors_analysed).toBe(2);
    expect(report.tenant.average_price).toBe(107.5);
    expect(report.price.band).not.toBe('unknown');
    expect(report.rating.rank).not.toBeNull();
    expect(report.rating.total).toBe(3, 'tenant + the two rated competitors');
    expect(report.unique_offerings.items).toContain('Eggs benedict');
    expect(report.headline).toContain('average dish price');
  });
});
