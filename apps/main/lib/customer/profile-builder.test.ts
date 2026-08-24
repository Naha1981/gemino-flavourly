import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVG_CHECK_CENTS,
  PROFILE_LOOKBACK_DAYS,
  aggregateReservations,
  buildProfileSnapshot,
  extractPreferences,
  type ReservationLike,
} from './profile-builder.ts';

const NOW = new Date('2026-08-24T12:00:00.000Z');
const MS_DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_DAY);
}

describe('unit: visit and spend aggregation', () => {
  test('completed visits are reservations whose date is before today', () => {
    const rows: ReservationLike[] = [
      { date: daysAgo(10), partySize: 2 },
      { date: daysAgo(5), partySize: 4 },
      { date: new Date('2026-08-24T18:00:00.000Z'), partySize: 6 },
    ];
    const agg = aggregateReservations(rows, { now: NOW });
    assert.equal(agg.totalVisits, 2);
    assert.equal(agg.totalSpendCents, (2 + 4) * AVG_CHECK_CENTS);
  });

  test('spend is party_size × 4900 for completed reservations only', () => {
    const rows: ReservationLike[] = [
      { date: daysAgo(2), partySize: 3 },
      { date: new Date('2026-08-30T19:00:00.000Z'), partySize: 10 },
    ];
    const agg = aggregateReservations(rows, { now: NOW });
    assert.equal(AVG_CHECK_CENTS, 4900);
    assert.equal(agg.totalSpendCents, 3 * 4900);
  });

  test('avg_party_size averages every reservation in the lookback window', () => {
    const rows: ReservationLike[] = [
      { date: daysAgo(20), partySize: 2 },
      { date: daysAgo(10), partySize: 4 },
      { date: daysAgo(2), partySize: 6 },
    ];
    const agg = aggregateReservations(rows, { now: NOW });
    assert.equal(agg.avgPartySize, 4);
  });

  test('first and last visit come from completed reservations only', () => {
    const rows: ReservationLike[] = [
      { date: daysAgo(40), partySize: 2 },
      { date: daysAgo(8), partySize: 2 },
      { date: new Date('2026-09-01T19:00:00.000Z'), partySize: 2 },
    ];
    const agg = aggregateReservations(rows, { now: NOW });
    assert.equal(agg.firstVisitAt?.toISOString(), daysAgo(40).toISOString());
    assert.equal(agg.lastVisitAt?.toISOString(), daysAgo(8).toISOString());
  });

  test('reservations older than 365 days are ignored', () => {
    const rows: ReservationLike[] = [
      { date: daysAgo(PROFILE_LOOKBACK_DAYS + 1), partySize: 8 },
      { date: daysAgo(10), partySize: 2 },
    ];
    const agg = aggregateReservations(rows, { now: NOW });
    assert.equal(agg.totalVisits, 1);
    assert.equal(agg.totalSpendCents, 2 * 4900);
  });
});

describe('unit: preference extraction', () => {
  test('finds dietary keywords', () => {
    const prefs = extractPreferences([
      { content: 'We are vegetarian and also gluten-free please' },
    ]);
    assert.deepEqual(prefs.dietary.sort(), ['gluten-free', 'vegetarian']);
  });

  test('finds occasions', () => {
    const prefs = extractPreferences([{ content: 'It is our anniversary, and a date night' }]);
    assert.ok(prefs.occasions.includes('anniversary'));
    assert.ok(prefs.occasions.includes('date night'));
  });

  test('extracts favorite dishes from "I love the [dish]"', () => {
    const prefs = extractPreferences([{ content: 'I love the lamb shank!' }]);
    assert.deepEqual(prefs.favorites, ['lamb shank']);
  });

  test('buildProfileSnapshot combines aggregates and preferences', () => {
    const snap = buildProfileSnapshot(
      [
        { date: daysAgo(3), partySize: 2 },
        { date: daysAgo(1), partySize: 4 },
      ],
      [{ content: 'halal please. I love the biryani' }],
      { now: NOW }
    );
    assert.equal(snap.totalVisits, 2);
    assert.equal(snap.avgPartySize, 3);
    assert.deepEqual(snap.preferences.dietary, ['halal']);
    assert.deepEqual(snap.preferences.favorites, ['biryani']);
  });
});

/**
 * In-memory stand-in for the store: creating a reservation rebuilds the
 * profile from the same builder the Drizzle adapter uses.
 */
function fakeProfileStore() {
  const reservations: Array<ReservationLike & { tenantId: string; phone: string }> = [];
  const profiles = new Map<string, ReturnType<typeof buildProfileSnapshot> & { tenantId: string; phone: string }>();

  function key(tenantId: string, phone: string) {
    return `${tenantId}::${phone}`;
  }

  return {
    createReservationAndSyncProfile(input: {
      tenantId: string;
      customerPhone: string;
      date: Date;
      partySize: number;
    }) {
      reservations.push({
        tenantId: input.tenantId,
        phone: input.customerPhone,
        date: input.date,
        partySize: input.partySize,
      });
      const mine = reservations.filter((r) => r.tenantId === input.tenantId && r.phone === input.customerPhone);
      const snap = buildProfileSnapshot(mine, [], { now: NOW });
      const row = { ...snap, tenantId: input.tenantId, phone: input.customerPhone };
      profiles.set(key(input.tenantId, input.customerPhone), row);
      return { profile: row };
    },
    listProfiles(tenantId: string, limit = 50, offset = 0) {
      return Array.from(profiles.values()).filter((p) => p.tenantId === tenantId).slice(offset, offset + limit);
    },
    getProfile(tenantId: string, phone: string) {
      return profiles.get(key(tenantId, phone)) ?? null;
    },
  };
}

describe('integration: creating a reservation updates the profile', () => {
  test('sync increments visits and spend', () => {
    const store = fakeProfileStore();
    store.createReservationAndSyncProfile({
      tenantId: 't1',
      customerPhone: '+27820000001',
      date: daysAgo(4),
      partySize: 2,
    });
    const first = store.getProfile('t1', '+27820000001');
    assert.equal(first?.totalVisits, 1);
    assert.equal(first?.totalSpendCents, 9800);

    store.createReservationAndSyncProfile({
      tenantId: 't1',
      customerPhone: '+27820000001',
      date: daysAgo(1),
      partySize: 4,
    });
    const second = store.getProfile('t1', '+27820000001');
    assert.equal(second?.totalVisits, 2);
    assert.equal(second?.totalSpendCents, 9800 + 19600);
    assert.equal(second?.avgPartySize, 3);
  });
});

describe('integration: paginated profile list', () => {
  test('listProfiles returns a page and never leaks another tenant', () => {
    const store = fakeProfileStore();
    for (let i = 0; i < 5; i += 1) {
      store.createReservationAndSyncProfile({
        tenantId: 't1',
        customerPhone: `+2782000000${i}`,
        date: daysAgo(2),
        partySize: 2,
      });
    }
    store.createReservationAndSyncProfile({
      tenantId: 'rival',
      customerPhone: '+27829999999',
      date: daysAgo(2),
      partySize: 8,
    });

    const page = store.listProfiles('t1', 2, 0);
    assert.equal(page.length, 2);
    assert.ok(page.every((p) => p.tenantId === 't1'));
    const all = store.listProfiles('t1', 50, 0);
    assert.equal(all.length, 5);
    assert.equal(store.listProfiles('rival', 50, 0).length, 1);
  });
});

describe('e2e: five reservations over 90 days', () => {
  test('profile shows total_visits=5 and correct avg_party_size', () => {
    const store = fakeProfileStore();
    const sizes = [2, 4, 3, 5, 6];
    sizes.forEach((partySize, i) => {
      store.createReservationAndSyncProfile({
        tenantId: 't1',
        customerPhone: '+27821112222',
        date: daysAgo(90 - i * 15),
        partySize,
      });
    });
    const profile = store.getProfile('t1', '+27821112222');
    assert.equal(profile?.totalVisits, 5);
    const expectedAvg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    assert.equal(profile?.avgPartySize, expectedAvg);
    assert.equal(profile?.totalSpendCents, sizes.reduce((a, b) => a + b, 0) * 4900);
  });
});

describe('tenant isolation', () => {
  test('profile queries are scoped by tenant_id', () => {
    const store = fakeProfileStore();
    store.createReservationAndSyncProfile({
      tenantId: 'mine',
      customerPhone: '+27820001111',
      date: daysAgo(2),
      partySize: 2,
    });
    store.createReservationAndSyncProfile({
      tenantId: 'theirs',
      customerPhone: '+27820001111',
      date: daysAgo(2),
      partySize: 10,
    });

    const mine = store.getProfile('mine', '+27820001111');
    const theirs = store.getProfile('theirs', '+27820001111');
    assert.equal(mine?.totalSpendCents, 9800);
    assert.equal(theirs?.totalSpendCents, 49000);
    assert.equal(store.listProfiles('mine').length, 1);
    assert.equal(store.listProfiles('mine')[0].totalSpendCents, 9800);
  });
});
