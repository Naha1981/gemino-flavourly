import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSignificantRatingDrop,
  formatRatingDropAlert,
  trendOf,
  runCompetitorRatingsCron,
  RATING_DROP_THRESHOLD,
  type CompetitorRatingsStore,
  type CompetitorRecord,
  type RatingReading,
} from './competitor-ratings.ts';

// ---------------------------------------------------------------------------
// Unit: pure decision functions
// ---------------------------------------------------------------------------

describe('isSignificantRatingDrop (0.2 threshold)', () => {
  test('a 0.2+ fall is significant', () => {
    assert.ok(isSignificantRatingDrop(4.5, 4.3));
    assert.ok(isSignificantRatingDrop(4.5, 4.0));
    assert.ok(isSignificantRatingDrop(3.0, 2.79));
  });

  test('a 0.19 fall, no change, and rises are not significant', () => {
    assert.ok(!isSignificantRatingDrop(4.5, 4.31));
    assert.ok(!isSignificantRatingDrop(4.5, 4.5));
    assert.ok(!isSignificantRatingDrop(4.3, 4.5));
  });

  test('non-finite inputs are never a drop', () => {
    assert.ok(!isSignificantRatingDrop(Number.NaN, 4.0));
    assert.ok(!isSignificantRatingDrop(4.5, Number.NaN));
    assert.ok(!isSignificantRatingDrop(Number.POSITIVE_INFINITY, 1));
  });

  test('threshold constant matches the gate contract', () => {
    assert.equal(RATING_DROP_THRESHOLD, 0.2);
  });
});

describe('formatRatingDropAlert', () => {
  test('copy matches the gate contract with one-decimal ratings', () => {
    assert.equal(
      formatRatingDropAlert('The Bull Pen', 4.6, 4.3),
      '⚠️ Competitor Alert: The Bull Pen rating dropped from 4.6 to 4.3. ' +
        'This is an opportunity to highlight your superior service.'
    );
  });
});

describe('trendOf', () => {
  const day = (n: number) => new Date(2026, 7, 20 + n);

  test('up / down / stable across a window', () => {
    assert.equal(
      trendOf([
        { rating: 4.0, reviewCount: 10, recordedAt: day(0) },
        { rating: 4.5, reviewCount: 12, recordedAt: day(2) },
      ]),
      'up'
    );
    assert.equal(
      trendOf([
        { rating: 4.5, reviewCount: 12, recordedAt: day(0) },
        { rating: 4.0, reviewCount: 14, recordedAt: day(2) },
      ]),
      'down'
    );
    assert.equal(
      trendOf([
        { rating: 4.3, reviewCount: 12, recordedAt: day(0) },
        { rating: 4.4, reviewCount: 14, recordedAt: day(2) },
      ]),
      'stable'
    );
  });

  test('fewer than two readings is stable', () => {
    assert.equal(trendOf([]), 'stable');
    assert.equal(trendOf([{ rating: 4.5, reviewCount: 1, recordedAt: day(0) }]), 'stable');
  });

  test('unsorted input is ordered by recordedAt internally', () => {
    assert.equal(
      trendOf([
        { rating: 4.5, reviewCount: 12, recordedAt: day(2) },
        { rating: 4.0, reviewCount: 10, recordedAt: day(0) },
      ]),
      'up'
    );
  });
});

// ---------------------------------------------------------------------------
// Integration: the cron runner
// ---------------------------------------------------------------------------

function competitor(overrides: Partial<CompetitorRecord> = {}): CompetitorRecord {
  return {
    id: 'comp-1',
    tenantId: 'tenant-1',
    name: 'The Bull Pen',
    googlePlaceId: 'place-x',
    currentRating: 4.6,
    reviewCount: 120,
    lastCheckAt: null,
    ...overrides,
  };
}

function memoryStore(
  existingReadings: Record<string, RatingReading[]> = {},
  fleet: CompetitorRecord[] = [competitor()]
) {
  const state = {
    readings: new Map<string, RatingReading[]>(Object.entries(existingReadings)),
    alerts: [] as Array<{ tenantId: string; text: string }>,
  };
  const store: CompetitorRatingsStore & { state: typeof state } = {
    state,
    async findAllCompetitors() {
      return fleet;
    },
    async getPreviousReading(competitorId) {
      const list = state.readings.get(competitorId) ?? [];
      return list.length > 0 ? list[list.length - 1] : null;
    },
    async recordReading(competitorId, rating, reviewCount, at) {
      const list = state.readings.get(competitorId) ?? [];
      list.push({ rating, reviewCount, recordedAt: at });
      state.readings.set(competitorId, list);
    },
    async createAlert(tenantId, text) {
      state.alerts.push({ tenantId, text });
    },
  };
  return store;
}

const YESTERDAY = new Date('2026-08-19T07:00:00Z');
const NOW = new Date('2026-08-20T07:00:00Z');

describe('runCompetitorRatingsCron', () => {
  test('first check records a reading, no alert (nothing to compare)', async () => {
    const store = memoryStore();
    const summary = await runCompetitorRatingsCron(store, {
      now: NOW,
      apiKey: 'k',
      fetchPlaceRatingFn: async () => ({ rating: 4.6, reviewCount: 120 }),
    });
    assert.equal(summary.competitorsChecked, 1);
    assert.equal(summary.ratingsRecorded, 1);
    assert.equal(summary.alertsCreated, 0);
    assert.equal(store.state.alerts.length, 0);
  });

  test('a 0.2+ drop records the reading AND raises an inbox alert', async () => {
    const store = memoryStore({
      'comp-1': [{ rating: 4.6, reviewCount: 120, recordedAt: YESTERDAY }],
    });
    const summary = await runCompetitorRatingsCron(store, {
      now: NOW,
      apiKey: 'k',
      fetchPlaceRatingFn: async () => ({ rating: 4.3, reviewCount: 121 }),
    });
    assert.equal(summary.ratingsRecorded, 1);
    assert.equal(summary.alertsCreated, 1);
    assert.equal(store.state.alerts[0].tenantId, 'tenant-1');
    assert.match(store.state.alerts[0].text, /The Bull Pen rating dropped from 4\.6 to 4\.3/);
  });

  test('a small wobble (< 0.2) records without an alert', async () => {
    const store = memoryStore({
      'comp-1': [{ rating: 4.6, reviewCount: 120, recordedAt: YESTERDAY }],
    });
    const summary = await runCompetitorRatingsCron(store, {
      now: NOW,
      apiKey: 'k',
      fetchPlaceRatingFn: async () => ({ rating: 4.5, reviewCount: 121 }),
    });
    assert.equal(summary.alertsCreated, 0);
  });

  test('no API key configured -> honest noApiKey summary, no calls', async () => {
    const store = memoryStore();
    let calls = 0;
    const summary = await runCompetitorRatingsCron(store, {
      now: NOW,
      apiKey: '',
      fetchPlaceRatingFn: async () => {
        calls += 1;
        return { rating: 4, reviewCount: 1 };
      },
    });
    assert.equal(summary.skipped.noApiKey, 1);
    assert.equal(calls, 0);
  });

  test('a listing with no rating yet is skipped as noRating', async () => {
    const store = memoryStore();
    const summary = await runCompetitorRatingsCron(store, {
      now: NOW,
      apiKey: 'k',
      fetchPlaceRatingFn: async () => null,
    });
    assert.equal(summary.skipped.noRating, 1);
    assert.equal(summary.ratingsRecorded, 0);
  });

  test('one competitor failing does not starve the rest of the fleet', async () => {
    const store = memoryStore(
      {},
      [competitor({ id: 'dead', name: 'Dead listing' }), competitor({ id: 'alive', name: 'Fine dining' })]
    );
    const summary = await runCompetitorRatingsCron(store, {
      now: NOW,
      apiKey: 'k',
      fetchPlaceRatingFn: async () => ({ rating: 4.2, reviewCount: 55 }),
    });
    assert.equal(summary.competitorsChecked, 2);
    assert.equal(summary.ratingsRecorded, 2);
    void store;
  });

  test('a thrown fetch error is counted as fetchFailed and the sweep continues', async () => {
    const store = memoryStore(
      {},
      [competitor({ id: 'a', name: 'A' }), competitor({ id: 'b', name: 'B', googlePlaceId: 'place-ok' })]
    );
    const summary = await runCompetitorRatingsCron(store, {
      now: NOW,
      apiKey: 'k',
      fetchPlaceRatingFn: async (placeId) => {
        if (placeId === 'place-x') throw new Error('500 boom');
        return { rating: 4.1, reviewCount: 9 };
      },
    });
    assert.equal(summary.skipped.fetchFailed, 1);
    assert.equal(summary.ratingsRecorded, 1);
  });

  test('the per-run limit caps the sweep', async () => {
    const fleet = ['a', 'b', 'c'].map((id) => competitor({ id, name: id }));
    const store = memoryStore({}, fleet);
    const summary = await runCompetitorRatingsCron(store, {
      now: NOW,
      apiKey: 'k',
      limit: 2,
      fetchPlaceRatingFn: async () => ({ rating: 4.0, reviewCount: 1 }),
    });
    assert.equal(summary.competitorsChecked, 2);
    assert.equal(summary.ratingsRecorded, 2);
  });
});
