import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runDiscovery, type DiscoveryStore } from './discovery.ts';
import type { Coordinates, NearbyRestaurant } from './geolocation.ts';

const BENONI: Coordinates = { latitude: -26.1881, longitude: 28.3208 };

function memoryStore(overrides: Partial<DiscoveryStore> = {}) {
  const state = {
    rows: new Map<string, { tenantId: string; placeId: string; isSelf: boolean }>(),
  };
  const store: DiscoveryStore & { state: typeof state } = {
    state,
    async getTenantPlaceId() {
      return 'own-place';
    },
    async getTenantAddress() {
      return '12 Main Road, Benoni';
    },
    async upsertCompetitor(tenantId, input) {
      const key = `${tenantId}:${input.googlePlaceId}`;
      const inserted = !state.rows.has(key);
      state.rows.set(key, { tenantId, placeId: input.googlePlaceId, isSelf: input.isSelf ?? false });
      return { inserted };
    },
    ...overrides,
  };
  return store;
}

function place(overrides: Partial<NearbyRestaurant> = {}): NearbyRestaurant {
  return {
    placeId: 'place-x',
    name: 'The Bull Pen',
    address: '12 Main Rd, Benoni',
    latitude: -26.19,
    longitude: 28.33,
    rating: 4.4,
    priceLevel: 2,
    websiteUrl: 'https://bullpen.example',
    phone: '011 555 0100',
    ...overrides,
  };
}

const GEOCODE = async () => BENONI;

describe('runDiscovery (Gate #15 flow)', () => {
  test('happy path: geocode -> nearby -> upsert with distance + self flag', async () => {
    const store = memoryStore();
    const result = await runDiscovery(store, 'tenant-1', {
      apiKey: 'k',
      geocode: GEOCODE,
      findNearby: async () => [place(), place({ placeId: 'own-place', name: 'My Own Restaurant' })],
    });

    assert.equal(result.originSource, 'geocoded');
    assert.deepEqual(result.origin, BENONI);
    assert.equal(result.found, 2);
    assert.equal(result.saved, 2);
    assert.equal(result.newCompetitors, 2);
    assert.equal(result.updated, 0);
    assert.equal(result.self, true); // own place discovered and flagged

    const selfRow = result.competitors.find((c) => c.placeId === 'own-place')!;
    assert.equal(selfRow.isSelf, true);
    const other = result.competitors.find((c) => c.placeId === 'place-x')!;
    assert.equal(other.isSelf, false);
    assert.ok(other.distanceKm !== null && other.distanceKm > 0.5 && other.distanceKm < 5);
  });

  test('re-running discovery updates instead of duplicating', async () => {
    const store = memoryStore();
    const nearby = [place()];
    const run = () =>
      runDiscovery(store, 'tenant-1', { apiKey: 'k', geocode: GEOCODE, findNearby: async () => nearby });

    const first = await run();
    const second = await run();
    assert.equal(first.newCompetitors, 1);
    assert.equal(second.updated, 1);
    assert.equal(second.newCompetitors, 0);
    assert.equal(store.state.rows.size, 1);
  });

  test('no API key -> honest noApiKey result, zero saves', async () => {
    const store = memoryStore();
    let nearbyCalls = 0;
    const result = await runDiscovery(store, 'tenant-1', {
      apiKey: '',
      geocode: GEOCODE,
      findNearby: async () => {
        nearbyCalls += 1;
        return [];
      },
    });
    assert.equal(result.skipped.noApiKey, true);
    assert.equal(nearbyCalls, 0);
    assert.equal(result.saved, 0);
  });

  test('no address -> noOrigin (cannot anchor the search)', async () => {
    const store = memoryStore({ getTenantAddress: async () => null });
    const result = await runDiscovery(store, 'tenant-1', {
      apiKey: 'k',
      geocode: GEOCODE,
      findNearby: async () => [place()],
    });
    assert.equal(result.skipped.noOrigin, true);
    assert.equal(result.saved, 0);
  });

  test('geocode failure degrades to noOrigin, not a crash', async () => {
    const store = memoryStore();
    const result = await runDiscovery(store, 'tenant-1', {
      apiKey: 'k',
      geocode: async () => {
        throw new Error('geocoding down');
      },
      findNearby: async () => [place()],
    });
    assert.equal(result.skipped.noOrigin, true);
  });

  test('places without coordinates still save (distance null)', async () => {
    const store = memoryStore();
    const result = await runDiscovery(store, 'tenant-1', {
      apiKey: 'k',
      geocode: GEOCODE,
      findNearby: async () => [place({ latitude: null, longitude: null })],
    });
    assert.equal(result.saved, 1);
    assert.equal(result.competitors[0].distanceKm, null);
  });

  test('one upsert failure does not abort the batch', async () => {
    const store = memoryStore({
      upsertCompetitor: async (_t, input) => {
        if (input.googlePlaceId === 'bad') throw new Error('db down');
        return { inserted: true };
      },
    });
    const result = await runDiscovery(store, 'tenant-1', {
      apiKey: 'k',
      geocode: GEOCODE,
      findNearby: async () => [place({ placeId: 'bad' }), place({ placeId: 'good' })],
    });
    assert.equal(result.found, 2);
    assert.equal(result.saved, 1);
  });
});
