import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REWARD,
  MAX_REWARD_DISTANCE_M,
  REWARD_EVENT_TTL_MINUTES,
  WELCOME_BONUS_POINTS,
  buildGeoClaimUrl,
  buildJoinReply,
  buildRedeemInsufficientReply,
  buildRedeemReply,
  decideRewardClaim,
  haversineDistanceM,
  largestAffordableReward,
  newClaimToken,
} from './reward-claim.ts';

/**
 * O1 — pure rules for GPS-gated redemption. Every money-relevant decision
 * is proven here without a database: the Haversine math, the 500m boundary,
 * catalog affordability, idempotency token shapes and the customer copy.
 */

// Johannesburg city centre — a real anchor so distances are realistic.
const RESTAURANT = { lat: -26.2041, lng: 28.0473 };

describe('haversineDistanceM', () => {
  test('zero distance for identical points', () => {
    assert.equal(haversineDistanceM(RESTAURANT, RESTAURANT), 0);
  });

  test('symmetric', () => {
    const b = { lat: -26.21, lng: 28.06 };
    assert.ok(
      Math.abs(haversineDistanceM(RESTAURANT, b) - haversineDistanceM(b, RESTAURANT)) < 1e-9
    );
  });

  test('known distance: ~111km per degree of latitude', () => {
    const north = { lat: RESTAURANT.lat + 1, lng: RESTAURANT.lng };
    const d = haversineDistanceM(RESTAURANT, north);
    // 1 degree latitude = 111.19 km at the equator-scale; ~111.0-111.5 km
    assert.ok(d > 110_000 && d < 112_000, `1 degree of latitude should be ~111km, got ${d}m`);
  });

  test('small distances are metre-scale, not degree-scale', () => {
    // ~0.0009 degrees latitude ≈ 100m
    const near = { lat: RESTAURANT.lat + 0.0009, lng: RESTAURANT.lng };
    const d = haversineDistanceM(RESTAURANT, near);
    assert.ok(d > 80 && d < 120, `expected ~100m, got ${d}m`);
  });
});

describe('decideRewardClaim — the 500m gate', () => {
  test('inside the radius verifies', () => {
    const guest = { lat: RESTAURANT.lat + 0.0009, lng: RESTAURANT.lng }; // ~100m
    const result = decideRewardClaim(guest, RESTAURANT);
    assert.equal(result.ok, true);
    assert.ok(result.distanceM > 80 && result.distanceM < 120);
  });

  test('just outside the radius rejects with the distance shown', () => {
    const guest = { lat: RESTAURANT.lat + 0.005, lng: RESTAURANT.lng }; // ~555m
    const result = decideRewardClaim(guest, RESTAURANT);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'too_far');
    assert.ok(result.distanceM > MAX_REWARD_DISTANCE_M);
  });

  test('MUTATION GUARD: the boundary is exactly 500m', () => {
    // If someone widens MAX_REWARD_DISTANCE_M or drops the <=, this fails.
    assert.equal(MAX_REWARD_DISTANCE_M, 500);
    // A guest exactly 500m away (by construction) is inside.
    // 500m north ≈ 0.0044916 degrees latitude.
    const guest = { lat: RESTAURANT.lat + 0.00449, lng: RESTAURANT.lng };
    const result = decideRewardClaim(guest, RESTAURANT);
    assert.equal(result.ok, true, `guest at ${result.distanceM}m must verify (<= 500m)`);
    assert.ok(result.distanceM <= 500);
  });
});

describe('largestAffordableReward', () => {
  const catalog = [
    { name: 'R10 off', pointsCost: 100 },
    { name: 'Dessert', pointsCost: 250 },
    { name: 'VIP table', pointsCost: 500 },
  ];

  test('picks the best reward the balance covers', () => {
    assert.equal(largestAffordableReward(260, catalog)?.name, 'Dessert');
    assert.equal(largestAffordableReward(1000, catalog)?.name, 'VIP table');
  });

  test('returns null when nothing is affordable', () => {
    assert.equal(largestAffordableReward(99, catalog), null);
    assert.equal(largestAffordableReward(0, catalog), null);
  });

  test('zero-cost rewards are never selected (infinite reward bug)', () => {
    const bad = [{ name: 'Free forever', pointsCost: 0 }];
    assert.equal(largestAffordableReward(0, bad), null);
  });

  test('empty catalog falls through to null (store supplies the default)', () => {
    assert.equal(largestAffordableReward(500, []), null);
  });
});

describe('tokens and links', () => {
  test('claim tokens are 48-hex and unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = newClaimToken();
      assert.match(t, /^[a-f0-9]{48}$/);
      seen.add(t);
    }
    assert.equal(seen.size, 200);
  });

  test('geo-claim URL shape', () => {
    assert.equal(
      buildGeoClaimUrl('https://gemino.app/', 'abc123'),
      'https://gemino.app/geo-claim/abc123'
    );
    assert.equal(
      buildGeoClaimUrl('', 'abc123'),
      'https://gemino.app/geo-claim/abc123'
    );
  });
});

describe('customer copy', () => {
  test('JOIN first time announces the welcome bonus', () => {
    const msg = buildJoinReply({ restaurantName: 'The Copper Pot', awarded: true, points: 50 });
    assert.match(msg, /welcome/i);
    assert.match(msg, /\*50 points\*/);
    assert.ok(msg.includes('50-point') || msg.includes(`${WELCOME_BONUS_POINTS}`));
  });

  test('JOIN repeat states current balance, not another bonus', () => {
    const msg = buildJoinReply({ restaurantName: 'The Copper Pot', awarded: false, points: 240 });
    assert.match(msg, /already/i);
    assert.match(msg, /\*240 points\*/);
    assert.doesNotMatch(msg, /welcome bonus/i);
  });

  test('REDEEM success copy carries the link, TTL and 500m rule', () => {
    const msg = buildRedeemReply({
      restaurantName: 'The Copper Pot',
      rewardName: 'R10 off your bill',
      pointsCost: 100,
      remainingPoints: 40,
      claimUrl: 'https://gemino.app/geo-claim/tok',
      ttlMinutes: REWARD_EVENT_TTL_MINUTES,
    });
    assert.ok(msg.includes('https://gemino.app/geo-claim/tok'));
    assert.match(msg, /500m/);
    assert.match(msg, new RegExp(`valid for ${REWARD_EVENT_TTL_MINUTES} minutes`));
    assert.match(msg, /\*40 points\*/);
  });

  test('REDEEM insufficient copy shows balance and requirement', () => {
    const msg = buildRedeemInsufficientReply({
      restaurantName: 'The Copper Pot',
      points: 40,
      needed: DEFAULT_REWARD.pointsCost,
    });
    assert.match(msg, /\*40 points\*/);
    assert.match(msg, /\*100\*/);
  });
});
