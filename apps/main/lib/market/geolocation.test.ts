import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RADIUS_KM,
  clampRadiusKm,
  discoverCompetitors,
  findNearbyRestaurants,
  getCoordinates,
  haversineKm,
  mealFlagName,
  nearbyFieldMask,
  parseGeocodeResponse,
  parseHourString,
  parseNearbyPlaces,
  parseOpeningPeriods,
  parsePriceLevel,
  roundKm,
} from './geolocation.ts';

/** Records every request so assertions cover the wire format, not just output. */
function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit; request?: Request }> = [];
  let i = 0;
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    calls.push({ url: request.url, init, request });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

const CAPE_TOWN = { latitude: -33.9249, longitude: 18.4241 };
const SEA_POINT = { latitude: -33.9188, longitude: 18.3911 }; // ~3.1km west

describe('geolocation: distance maths', () => {
  test('haversine matches the known 1-degree-of-longitude distance at the equator', () => {
    const km = haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    assert.ok(Math.abs(km - 111.195) < 0.5, `expected ~111.195km, got ${km}`);
  });

  test('haversine is symmetric and zero for the same point', () => {
    assert.equal(haversineKm(CAPE_TOWN, CAPE_TOWN), 0);
    const a = haversineKm(CAPE_TOWN, SEA_POINT);
    const b = haversineKm(SEA_POINT, CAPE_TOWN);
    assert.ok(Math.abs(a - b) < 1e-9);
    assert.ok(a > 3 && a < 3.5, `Cape Town -> Sea Point should be ~3.1km, got ${a}`);
  });

  test('roundKm keeps one decimal, not float noise', () => {
    assert.equal(roundKm(2.999999999), 3);
    assert.equal(roundKm(0.04), 0);
    assert.equal(roundKm(4.96), 5);
  });
});

describe('geolocation: payload normalization', () => {
  test('price level accepts numbers, enum strings, and rejects everything else', () => {
    assert.equal(parsePriceLevel(2), 2);
    assert.equal(parsePriceLevel('PRICE_LEVEL_MODERATE'), 2);
    assert.equal(parsePriceLevel('PRICE_LEVEL_VERY_EXPENSIVE'), 4);
    assert.equal(parsePriceLevel('PRICE_LEVEL_FREE'), 0);
    assert.equal(parsePriceLevel('cheap'), null);
    assert.equal(parsePriceLevel(99), null);
    assert.equal(parsePriceLevel(null), null);
    assert.equal(parsePriceLevel(undefined), null);
  });

  test('hour strings parse as HH:MM and reject nonsense', () => {
    assert.equal(parseHourString('1130'), '11:30');
    assert.equal(parseHourString('930'), '09:30');
    assert.equal(parseHourString('0'), '00:00');
    assert.equal(parseHourString('2400'), null);
    assert.equal(parseHourString('1275'), null);
    assert.equal(parseHourString('eleven'), null);
    assert.equal(parseHourString(undefined), null);
  });

  test('meal flag fields are snake-cased without the serves prefix', () => {
    assert.equal(mealFlagName('servesBrunch'), 'brunch');
    assert.equal(mealFlagName('servesVegetarianFood'), 'vegetarian_food');
  });

  test('opening periods normalize and sort by day, dropping unusable rows', () => {
    const periods = parseOpeningPeriods({
      periods: [
        { open: { day: 3, hour: '1700' }, close: { day: 3, hour: '2300' } },
        { open: { day: 0, hour: '0900' }, close: { day: 0, hour: '1400' } },
        { open: { day: 9, hour: '0900' }, close: { day: 9, hour: '1000' } }, // invalid day
        { open: { hour: '0900' }, close: { hour: '1000' } }, // no day
      ],
    });
    assert.deepEqual(periods, [
      { day: 0, open: '09:00', close: '14:00' },
      { day: 3, open: '17:00', close: '23:00' },
    ]);
    assert.deepEqual(parseOpeningPeriods(null), []);
  });

  test('geocode results need a location; the first usable one wins', () => {
    assert.equal(parseGeocodeResponse({ results: [] }), null);
    assert.equal(parseGeocodeResponse({}), null);
    assert.equal(parseGeocodeResponse(null), null);
    assert.deepEqual(
      parseGeocodeResponse({
        results: [
          { formatted_address: 'no geometry here' },
          {
            formatted_address: '12 Loop St, Cape Town',
            geometry: { location: { lat: -33.92, lng: 18.42 }, location_type: 'ROOFTOP' },
          },
        ],
      }),
      {
        latitude: -33.92,
        longitude: 18.42,
        formattedAddress: '12 Loop St, Cape Town',
        locationType: 'ROOFTOP',
      }
    );
  });

  test('nearby places are normalized, distance-sorted, and ghosts are skipped', () => {
    const parsed = parseNearbyPlaces(
      {
        places: [
          {
            id: 'ChIJ-far',
            displayName: { text: 'Far Away Grill' },
            formattedAddress: '99 Outer Rd',
            location: { latitude: CAPE_TOWN.latitude + 0.05, longitude: CAPE_TOWN.longitude },
            rating: 4.6,
            userRatingCount: 320,
            priceLevel: 'PRICE_LEVEL_EXPENSIVE',
            primaryType: 'steak_house',
            types: ['steak_house', 'restaurant'],
            websiteUri: 'https://faraway.example',
            nationalPhoneNumber: '021 555 0100',
            servesBrunch: true,
            servesVegetarianFood: true,
            regularOpeningHours: { periods: [{ open: { day: 0, hour: '0900' }, close: { day: 0, hour: '1500' } }] },
          },
          {
            id: 'ChIJ-near',
            displayName: { text: ' Corner Cafe ' },
            location: { latitude: CAPE_TOWN.latitude + 0.002, longitude: CAPE_TOWN.longitude },
          },
          { displayName: { text: 'No id, cannot dedupe' } }, // skipped
          { id: 'ChIJ-nameless' }, // skipped
        ],
      },
      CAPE_TOWN
    );

    assert.equal(parsed.length, 2, 'rows without an id or a name are dropped');
    assert.equal(parsed[0].googlePlaceId, 'ChIJ-near', 'nearest first');
    assert.equal(parsed[0].name, 'Corner Cafe', 'name is trimmed');
    assert.equal(parsed[0].distanceKm, 0.2);
    assert.equal(parsed[0].rating, null);
    assert.equal(parsed[1].googlePlaceId, 'ChIJ-far');
    assert.equal(parsed[1].distanceKm, 5.6);
    assert.equal(parsed[1].priceLevel, 3);
    assert.deepEqual(parsed[1].serves, ['brunch', 'vegetarian_food']);
    assert.deepEqual(parsed[1].openingHours, [{ day: 0, open: '09:00', close: '15:00' }]);
    assert.equal(parsed[1].websiteUrl, 'https://faraway.example');
    assert.equal(parsed[1].phone, '021 555 0100');
  });

  test('places with no coordinates keep a null distance and sort last', () => {
    const parsed = parseNearbyPlaces(
      {
        places: [
          { id: 'ChIJ-nocoords', displayName: { text: 'No Coords' } },
          {
            id: 'ChIJ-coords',
            displayName: { text: 'Has Coords' },
            location: { latitude: CAPE_TOWN.latitude, longitude: CAPE_TOWN.longitude + 0.01 },
          },
        ],
      },
      CAPE_TOWN
    );
    assert.equal(parsed[0].googlePlaceId, 'ChIJ-coords');
    assert.equal(parsed[1].distanceKm, null);
  });

  test('field mask stays off the Atmosphere SKU unless asked for', () => {
    const base = nearbyFieldMask();
    assert.ok(base.includes('places.id'));
    assert.ok(base.includes('places.websiteUri'));
    assert.ok(base.includes('places.priceLevel'));
    assert.doesNotMatch(base, /servesBrunch/);
    assert.doesNotMatch(base, /regularOpeningHours/);

    const opted = nearbyFieldMask({ includeMealFlags: true, includeOpeningHours: true });
    assert.ok(opted.includes('places.servesBrunch'));
    assert.ok(opted.includes('places.regularOpeningHours'));
  });

  test('radius is clamped to the API limits', () => {
    assert.equal(clampRadiusKm(undefined), 5);
    assert.equal(clampRadiusKm(0), 5);
    assert.equal(clampRadiusKm(-3), 5);
    assert.equal(clampRadiusKm(Number.NaN), 5);
    assert.equal(clampRadiusKm(3), 3);
    assert.equal(clampRadiusKm(120), MAX_RADIUS_KM);
  });
});

describe('geolocation: getCoordinates', () => {
  test('sends the address + key to the Geocoding API and parses the result', async () => {
    const { impl, calls } = fakeFetch([
      {
        body: {
          status: 'OK',
          results: [
            {
              formatted_address: '12 Loop St, Cape Town',
              geometry: { location: { lat: -33.92, lng: 18.42 }, location_type: 'ROOFTOP' },
            },
          ],
        },
      },
    ]);

    const coords = await getCoordinates('  12 Loop St, Cape Town  ', { apiKey: 'test-key', fetchImpl: impl });
    assert.deepEqual(coords, {
      latitude: -33.92,
      longitude: 18.42,
      formattedAddress: '12 Loop St, Cape Town',
      locationType: 'ROOFTOP',
    });

    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, 'https://maps.googleapis.com/maps/api/geocode/json');
    assert.equal(url.searchParams.get('address'), '12 Loop St, Cape Town');
    assert.equal(url.searchParams.get('key'), 'test-key');
  });

  test('ZERO_RESULTS is null, not an error', async () => {
    const { impl } = fakeFetch([{ body: { status: 'ZERO_RESULTS', results: [] } }]);
    const coords = await getCoordinates('nowhere at all', { apiKey: 'k', fetchImpl: impl });
    assert.equal(coords, null);
  });

  test('an API rejection throws with the status in the message', async () => {
    const { impl } = fakeFetch([{ body: { status: 'REQUEST_DENIED', error_message: 'bad key' } }]);
    await assert.rejects(
      () => getCoordinates('12 Loop St', { apiKey: 'k', fetchImpl: impl }),
      /REQUEST_DENIED.*bad key/
    );
  });

  test('a transport failure surfaces the HTTP status', async () => {
    const { impl } = fakeFetch([{ status: 503, body: { error: 'upstream' } }]);
    await assert.rejects(() => getCoordinates('12 Loop St', { apiKey: 'k', fetchImpl: impl }), /503/);
  });

  test('an empty address and a missing key both fail loudly', async () => {
    await assert.rejects(() => getCoordinates('   ', { apiKey: 'k' }), /address is required/i);
    const saved = process.env.GOOGLE_MAPS_API_KEY;
    const savedFallbacks = [process.env.GOOGLE_GEOCODING_API_KEY, process.env.GOOGLE_PLACES_API_KEY];
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    try {
      await assert.rejects(() => getCoordinates('12 Loop St'), /GOOGLE_MAPS_API_KEY is not set/);
    } finally {
      if (saved !== undefined) process.env.GOOGLE_MAPS_API_KEY = saved;
      if (savedFallbacks[0] !== undefined) process.env.GOOGLE_GEOCODING_API_KEY = savedFallbacks[0];
      if (savedFallbacks[1] !== undefined) process.env.GOOGLE_PLACES_API_KEY = savedFallbacks[1];
    }
  });
});

describe('geolocation: findNearbyRestaurants', () => {
  const payload = {
    places: [
      {
        id: 'ChIJ-one',
        displayName: { text: 'The Bull Pen' },
        formattedAddress: '5 Bree St',
        location: { latitude: CAPE_TOWN.latitude + 0.01, longitude: CAPE_TOWN.longitude },
        rating: 4.4,
        userRatingCount: 210,
        priceLevel: 2,
        websiteUri: 'https://bullpen.example',
      },
    ],
  };

  test('posts a circle restriction in METRES and asks for restaurants only', async () => {
    const { impl, calls } = fakeFetch([{ body: payload }]);
    const results = await findNearbyRestaurants(CAPE_TOWN.latitude, CAPE_TOWN.longitude, 5, {
      apiKey: 'places-key',
      fetchImpl: impl,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'The Bull Pen');
    assert.equal(results[0].distanceKm, 1.1);

    const request = calls[0].request as Request;
    assert.equal(request.url, 'https://places.googleapis.com/v1/places:searchNearby');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('X-Goog-Api-Key'), 'places-key');
    assert.ok((request.headers.get('X-Goog-FieldMask') ?? '').includes('places.displayName'));

    const body = JSON.parse(String(await new Response(request.body).text()));
    assert.deepEqual(body.includedTypes, ['restaurant']);
    assert.equal(body.maxResultCount, 20);
    assert.equal(body.locationRestriction.circle.radius, 5000, 'radius must be metres, not km');
    assert.equal(body.locationRestriction.circle.center.latitude, CAPE_TOWN.latitude);
  });

  test('an over-limit radius is clamped rather than rejected by Google', async () => {
    const { impl, calls } = fakeFetch([{ body: payload }]);
    await findNearbyRestaurants(CAPE_TOWN.latitude, CAPE_TOWN.longitude, 999, {
      apiKey: 'k',
      fetchImpl: impl,
    });
    const body = JSON.parse(String(await new Response((calls[0].request as Request).body).text()));
    assert.equal(body.locationRestriction.circle.radius, MAX_RADIUS_KM * 1000);
  });

  test('no results is an empty list, an API error is a throw', async () => {
    const empty = fakeFetch([{ body: {} }]);
    assert.deepEqual(
      await findNearbyRestaurants(CAPE_TOWN.latitude, CAPE_TOWN.longitude, 5, {
        apiKey: 'k',
        fetchImpl: empty.impl,
      }),
      []
    );

    const denied = fakeFetch([{ status: 403, body: { error: { message: 'key not enabled' } } }]);
    await assert.rejects(
      () =>
        findNearbyRestaurants(CAPE_TOWN.latitude, CAPE_TOWN.longitude, 5, {
          apiKey: 'k',
          fetchImpl: denied.impl,
        }),
      /403/
    );
  });

  test('invalid coordinates are rejected before any call', async () => {
    const { impl, calls } = fakeFetch([{ body: payload }]);
    await assert.rejects(
      () => findNearbyRestaurants(Number.NaN, CAPE_TOWN.longitude, 5, { apiKey: 'k', fetchImpl: impl }),
      /Valid latitude and longitude/
    );
    assert.equal(calls.length, 0);
  });
});

describe('geolocation: discoverCompetitors (geocode -> nearby)', () => {
  test('geocodes the address, then searches around the returned point', async () => {
    const { impl, calls } = fakeFetch([
      {
        body: {
          status: 'OK',
          results: [
            {
              formatted_address: '12 Loop St, Cape Town',
              geometry: { location: { lat: CAPE_TOWN.latitude, lng: CAPE_TOWN.longitude } },
            },
          ],
        },
      },
      {
        body: {
          places: [
            {
              id: 'ChIJ-one',
              displayName: { text: 'The Bull Pen' },
              location: { latitude: CAPE_TOWN.latitude + 0.02, longitude: CAPE_TOWN.longitude },
            },
          ],
        },
      },
    ]);

    const result = await discoverCompetitors('12 Loop St, Cape Town', {
      apiKey: 'k',
      radiusKm: 5,
      fetchImpl: impl,
    });

    assert.equal(result.radiusKm, 5);
    assert.equal(result.origin.latitude, CAPE_TOWN.latitude);
    assert.equal(result.restaurants.length, 1);
    assert.equal(result.restaurants[0].distanceKm, 2.2);
    assert.equal(calls.length, 2, 'exactly two API calls: one geocode, one nearby search');
    assert.match(calls[0].url, /geocode\/json/);
    assert.equal((calls[1].request as Request).url, 'https://places.googleapis.com/v1/places:searchNearby');
  });

  test('an ungeocodable address throws instead of searching around 0,0', async () => {
    const { impl, calls } = fakeFetch([{ body: { status: 'ZERO_RESULTS', results: [] } }]);
    await assert.rejects(() => discoverCompetitors('nowhere', { apiKey: 'k', fetchImpl: impl }), /No coordinates found/);
    assert.equal(calls.length, 1, 'no nearby search is issued without an origin');
  });
});
