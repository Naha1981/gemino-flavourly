import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCustomerSegment,
  confidenceForSegment,
  daysSince,
  recencyScore,
  type CustomerProfileForSegmentation,
} from './segmentation.ts';
import {
  runCustomerSegmentationCron,
  type SegmentationProfile,
} from './segmentation-cron.ts';

const NOW = new Date('2026-08-24T12:00:00.000Z');
const MS_DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_DAY);
}

function profile(overrides: Partial<CustomerProfileForSegmentation>): CustomerProfileForSegmentation {
  return {
    totalVisits: 0,
    totalSpendCents: 0,
    lastVisitAt: null,
    firstVisitAt: null,
    ...overrides,
  };
}

describe('unit: customer segment classification', () => {
  test('classifies a high-frequency, high-spend recent customer as VIP', () => {
    const result = calculateCustomerSegment(
      profile({ totalVisits: 12, totalSpendCents: 300_000, lastVisitAt: daysAgo(30), firstVisitAt: daysAgo(240) }),
      { now: NOW }
    );
    assert.equal(result.segment, 'vip');
    assert.equal(result.confidence, 1);
  });

  test('classifies a qualifying recent customer as Regular', () => {
    const result = calculateCustomerSegment(
      profile({ totalVisits: 4, totalSpendCents: 50_000, lastVisitAt: daysAgo(60), firstVisitAt: daysAgo(180) }),
      { now: NOW }
    );
    assert.equal(result.segment, 'regular');
    assert.ok(result.confidence > 0 && result.confidence < 1);
  });

  test('classifies a customer with an intermediate stale visit as At-risk', () => {
    const result = calculateCustomerSegment(
      profile({ totalVisits: 2, totalSpendCents: 20_000, lastVisitAt: daysAgo(150), firstVisitAt: daysAgo(200) }),
      { now: NOW }
    );
    assert.deepEqual(result, { segment: 'at_risk', confidence: 1 });
  });

  test('classifies an old visit as Dormant', () => {
    const result = calculateCustomerSegment(
      profile({ totalVisits: 3, totalSpendCents: 30_000, lastVisitAt: daysAgo(181), firstVisitAt: daysAgo(300) }),
      { now: NOW }
    );
    assert.deepEqual(result, { segment: 'dormant', confidence: 1 });
  });

  test('classifies a profile with no visits as Dormant', () => {
    const result = calculateCustomerSegment(profile({}), { now: NOW });
    assert.deepEqual(result, { segment: 'dormant', confidence: 1 });
  });

  test('classifies a single recent visit as New', () => {
    const result = calculateCustomerSegment(
      profile({ totalVisits: 1, totalSpendCents: 12_000, lastVisitAt: daysAgo(30), firstVisitAt: daysAgo(30) }),
      { now: NOW }
    );
    assert.deepEqual(result, { segment: 'new', confidence: 1 });
  });

  test('keeps VIP priority when a profile also meets Regular thresholds', () => {
    const result = calculateCustomerSegment(
      profile({ totalVisits: 10, totalSpendCents: 200_000, lastVisitAt: daysAgo(1), firstVisitAt: daysAgo(365) }),
      NOW
    );
    assert.equal(result.segment, 'vip');
  });
});

describe('unit: confidence scores', () => {
  test('recency score is 1 today, halfway at 90 days, and zero at 180 days', () => {
    assert.equal(recencyScore(0), 1);
    assert.equal(recencyScore(90), 0.5);
    assert.equal(recencyScore(180), 0);
    assert.equal(recencyScore(null), 0);
  });

  test('VIP confidence follows the visits, spend, and recency formula', () => {
    const customer = profile({ totalVisits: 10, totalSpendCents: 200_000, lastVisitAt: daysAgo(90) });
    const result = confidenceForSegment('vip', customer, { now: NOW });
    assert.equal(result, (1 + 1 + 0.5) / 3);
  });

  test('Regular confidence is capped at one when the profile exceeds all thresholds', () => {
    const customer = profile({ totalVisits: 8, totalSpendCents: 100_000, lastVisitAt: daysAgo(1) });
    assert.equal(confidenceForSegment('regular', customer, { now: NOW }), 1);
  });

  test('At-risk confidence is one only inside the 120-to-180 day window', () => {
    const customer = profile({ totalVisits: 2, lastVisitAt: daysAgo(150) });
    assert.equal(confidenceForSegment('at_risk', customer, { now: NOW }), 1);
    assert.equal(
      confidenceForSegment('at_risk', profile({ totalVisits: 2, lastVisitAt: daysAgo(30) }), { now: NOW }),
      0.5
    );
  });

  test('days are calculated from the injected clock and invalid dates are unknown', () => {
    assert.equal(daysSince(daysAgo(10), NOW), 10);
    assert.equal(daysSince('not-a-date', NOW), null);
  });
});

describe('integration: segmentation cron updates every tenant independently', () => {
  test('recalculates profiles and skips writes when the segment is unchanged', async () => {
    const profiles: SegmentationProfile[] = [
      {
        id: 'vip-a',
        tenantId: 'tenant-a',
        totalVisits: 12,
        totalSpendCents: 300_000,
        lastVisitAt: daysAgo(30),
        firstVisitAt: daysAgo(240),
      },
      {
        id: 'new-a',
        tenantId: 'tenant-a',
        totalVisits: 1,
        totalSpendCents: 4_900,
        lastVisitAt: daysAgo(3),
        firstVisitAt: daysAgo(3),
      },
      {
        id: 'regular-b',
        tenantId: 'tenant-b',
        totalVisits: 4,
        totalSpendCents: 50_000,
        lastVisitAt: daysAgo(20),
        firstVisitAt: daysAgo(180),
      },
    ];
    const current = new Map([
      ['vip-a', 'vip'],
      ['new-a', 'new'],
      ['regular-b', 'new'],
    ]);
    const fetches: string[] = [];
    const updates: Array<{ id: string; segment: string; tenantId?: string }> = [];

    const summary = await runCustomerSegmentationCron(
      {
        async findTenantIds() {
          return ['tenant-a', 'tenant-b'];
        },
        async fetchProfilesForSegmentation(tenantId) {
          fetches.push(tenantId);
          return profiles.filter((candidate) => candidate.tenantId === tenantId);
        },
        async updateSegment(profileId, segment) {
          const changed = current.get(profileId) !== segment;
          if (changed) {
            current.set(profileId, segment);
            updates.push({ id: profileId, segment });
          }
          return changed;
        },
      },
      { now: NOW }
    );

    assert.deepEqual(fetches, ['tenant-a', 'tenant-b']);
    assert.equal(summary.tenantsChecked, 2);
    assert.equal(summary.profilesScanned, 3);
    assert.equal(summary.segmentsUpdated, 1);
    assert.equal(summary.failed, 0);
    assert.deepEqual(updates, [{ id: 'regular-b', segment: 'regular' }]);
    assert.equal(current.get('regular-b'), 'regular');
  });

  test('refuses a profile returned for a different tenant', async () => {
    const updated: string[] = [];
    const summary = await runCustomerSegmentationCron(
      {
        async findTenantIds() {
          return ['tenant-a'];
        },
        async fetchProfilesForSegmentation() {
          return [
            {
              id: 'leak',
              tenantId: 'tenant-b',
              totalVisits: 12,
              totalSpendCents: 300_000,
              lastVisitAt: daysAgo(1),
              firstVisitAt: daysAgo(20),
            },
          ];
        },
        async updateSegment(profileId) {
          updated.push(profileId);
          return true;
        },
      },
      { now: NOW }
    );

    assert.equal(summary.failed, 1);
    assert.deepEqual(updated, []);
  });
});
