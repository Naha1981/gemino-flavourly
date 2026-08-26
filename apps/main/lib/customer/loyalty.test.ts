import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointsForSpend,
  rewardsRedeemable,
  valueOffInRand,
  loyaltyBalanceMessage,
  REWARD_POINTS_PER_R10,
  REWARD_RAND_PER_100_POINTS,
} from './loyalty.ts';

describe('loyalty rules — R1 spent = 1 point, 100 points = R10 off', () => {
  test('earns exactly 1 point per R1 spent (cents -> rand, floored)', () => {
    assert.equal(pointsForSpend(100), 1); // R1
    assert.equal(pointsForSpend(250_00), 250); // R250
    assert.equal(pointsForSpend(99), 0); // < R1
    assert.equal(pointsForSpend(-500), 0);
  });

  test('100 points = R10 off', () => {
    assert.equal(REWARD_POINTS_PER_R10, 100);
    assert.equal(REWARD_RAND_PER_100_POINTS, 10);
    assert.equal(rewardsRedeemable(100), 1);
    assert.equal(valueOffInRand(100), 10);
  });

  test('partially-earned rewards floor down', () => {
    assert.equal(rewardsRedeemable(199), 1); // 100 pts = R10, leftover 99
    assert.equal(valueOffInRand(199), 10);
    assert.equal(rewardsRedeemable(250), 2);
    assert.equal(valueOffInRand(250), 20);
    assert.equal(rewardsRedeemable(0), 0);
  });
});

describe('loyalty — customer-facing balance copy', () => {
  test('mentions the PRD rule and a redeemable amount when points are earned', () => {
    const msg = loyaltyBalanceMessage('Marble', 250);
    assert.match(msg, /250 loyalty points/);
    assert.match(msg, /100 points = R10 off/);
    assert.match(msg, /R20 off/);
    assert.match(msg, /every R1/);
  });

  test('is honest when there is nothing redeemable yet', () => {
    const msg = loyaltyBalanceMessage('Marble', 50);
    assert.match(msg, /50 loyalty points/);
    assert.match(msg, /100 points = R10 off/);
    assert.doesNotMatch(msg, /R.*off ready/);
  });
});
