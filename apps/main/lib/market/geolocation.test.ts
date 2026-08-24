import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineKm,
  getCoordinates,
  parsePriceLevel,
  parseNearbyResults,
  findNearbyRestaurants,
  DEFAULT_DISCOVERY_RADIUS_KM,
} from './geolocation.ts';

const BENONI = { latitude: -26.1881, longitude: 28.3208 };

describe('haversineKm', () => {
  test('same point is 0 km', () => {
    assert.equal(haversineKm(BENONI, BENONI), 0);
  });

  test('Benoni -> Boksburg (~9-10 km) lands in the right ballpark', () => {
    const boksburg = { latitude: -26.2125, longitude: 28.2635 };
    const km = haversineKm(BENONI, boksburg);
    assert.ok(km > 5 && km < 15, `expected 5-15km, got ${km}`);
  });

  test('is symmetric', () => {
    const p2 = { latitude: -26.2, longitude: 28.4 };
    assert.ok(Math.abs(haversineKm(BENONI, p2) - haversineKm(p2, BENONI)) < 1e-9);
  });
});

describe('parsePriceLevel', () => {
  test('maps every Google label to its integer level', () => {
    assert.equal(parsePriceLevel('PRICE_LEVEL_FREE'), 0);
    assert.equal(parsePriceLevel('PRICE_LEVEL_INEXPENSIVE'), 1);
    assert.equal(parsePriceLevel('PRICE_LEVEL_MODERATE'), 2);
    assert.equal(parsePriceLevel('PRICE_LEVEL_EXPENSIVE'), 3);
    assert.equal(parsePriceLevel('PRICE_LEVEL_VERY_EXPENSIVE'), 4);
  });

  test('unknown shapes return null, never a guess', () => {
    assert.equal(parsePriceLevel('PRICE_LEVEL_WAT'), null);
    assert.equal(parsePriceLevel('MODERATE'), null);
    assert.equal(parsePriceLevel(2), null);
    assert.equal(parsePriceLevel(null), null);
  });
});

describe('parseNearbyResults', () => {
  const payload = {
    places: [
      {
        id: 'place-a',
        displayName: { text: 'The Bull Pen' },
        formattedAddress: '12 Main Rd, Benoni',
        location: { latitude: -26.19, longitude: 28.33 },
        rating: 4.4,
        priceLevel: 'PRICE_LEVEL_MODERATE',
        websiteUri: 'https://bullpen.example/menu',
        nationalPhoneNumber: '011 555 0100',
      },
      {
        id: 'place-b',
        displayName: { text: 'Sushi Yamu' },
        location: { latitude: -26.18, longitude: 28.31 },
      },
      // Malformed entries are skipped, not crashed on:
      { id: 'no-name' },
      { displayName: { text: 'no id' } },
    ],
  };

  test('normalizes full records and tolerates sparse ones', () => {
    const results = parseNearbyResults(payload);
    assert.equal(results.length, 2);

    const [a, b] = results;
    assert.equal(a.placeId, 'place-a');
    assert.equal(a.name, 'The Bull Pen');
    assert.equal(a.address, '12 Main Rd, Benoni');
    assert.equal(a.rating, 4.4);
    assert.equal(a.priceLevel, 2);
    assert.equal(a.websiteUrl, 'https://bullpen.example/menu');
    assert.equal(a.phone, '011 555 0100');

    assert.equal(b.name, 'Sushi Yamu');
    assert.equal(b.address, null);
    assert.equal(b.rating, null);
    assert.equal(b.priceLevel, null);
    assert.equal(b.websiteUrl, null);
    assert.equal(b.phone, null);
  });

  test('empty payloads return []', () => {
    assert.deepEqual(parseNearbyResults({}), []);
    assert.deepEqual(parseNearbyResults({ places: [] }), []);
    assert.deepEqual(parseNearbyResults(null), []);
  });
});

describe('getCoordinates (injectable transport)', () => {
  function geocodeResponse(results: unknown[], status = 'OK'): Response {
    return new Response(JSON.stringify({ status, results }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  test('returns coordinates for the first result', async () => {
    const fetchImpl = (async () =>
      geocodeResponse([{ geometry: { location: { lat: -26.1881, lng: 28.3208 } } }])) as unknown as typeof fetch;
    const coords = await getCoordinates('12 Main Rd, Benoni', 'k', { fetchImpl });
    assert.deepEqual(coords, BENONI);
  });

  test('unresolvable address returns null', async () => {
    const fetchImpl = (async () => geocodeResponse([], 'ZERO_RESULTS')) as unknown as typeof fetch;
    assert.equal(await getCoordinates('nowhere xyz', 'k', { fetchImpl }), null);
  });

  test('API error surfaces as a throw', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    await assert.rejects(getCoordinates('x', 'k', { fetchImpl }), /500/);
  });
});

describe('findNearbyRestaurants (injectable transport)', () => {
  test('happy path sends the right shape and returns parsed places', async () => {
    const captured: { value?: { url: string; init: RequestInit } } = {};
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured.value = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ places: [{ id: 'p1', displayName: { text: 'Place' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const results = await findNearbyRestaurants(BENONI, 5, 'test-key', { fetchImpl });
    assert.equal(results.length, 1);
    assert.equal(results[0].placeId, 'p1');

    const sent = captured.value!;
    assert.equal(sent.url, 'https://places.googleapis.com/v1/places:searchNearby');
    const headers = sent.init.headers as Record<string, string>;
    assert.equal(headers['X-Goog-Api-Key'], 'test-key');
    assert.match(headers['X-Goog-FieldMask'], /places\.priceLevel/);
    const body = JSON.parse(String(sent.init.body));
    assert.deepEqual(body.includedTypes, ['restaurant']);
    assert.equal(body.locationRestriction.circle.radius, 5000);
    assert.equal(body.locationRestriction.circle.center.latitude, BENONI.latitude);
  });

  test('radius is clamped to the API max, not rejected', async () => {
    const captured: { radius?: number } = {};
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      captured.radius = JSON.parse(String(init?.body)).locationRestriction.circle.radius;
      return new Response(JSON.stringify({ places: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await findNearbyRestaurants(BENONI, 999, 'k', { fetchImpl });
    assert.equal(captured.radius, 50000);
  });

  test('API error surfaces as a throw', async () => {
    const fetchImpl = (async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    await assert.rejects(findNearbyRestaurants(BENONI, 5, 'bad', { fetchImpl }), /403/);
  });

  test('default discovery radius is the gate contract 5km', () => {
    assert.equal(DEFAULT_DISCOVERY_RADIUS_KM, 5);
  });
});
