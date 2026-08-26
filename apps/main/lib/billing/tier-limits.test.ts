import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER_LIMITS,
  planToTier,
  checkTierSendAllowed,
  tierLimitBlockedMessage,
} from './tier-limits.ts';

describe('tier limits — plan mapping', () => {
  test('maps known plans and defaults unknown to starter', () => {
    assert.equal(planToTier('premium'), 'premium');
    assert.equal(planToTier('Signature'), 'signature');
    assert.equal(planToTier(null), 'starter');
    assert.equal(planToTier('bogus'), 'starter');
  });

  test('Starter is capped at 500 messages/month and 100/hour', () => {
    assert.equal(TIER_LIMITS.starter.monthlyMessages, 500);
    assert.equal(TIER_LIMITS.starter.hourlyRate, 100);
  });

  test('Group is unlimited monthly', () => {
    assert.equal(TIER_LIMITS.group.monthlyMessages, Infinity);
  });

  test('Signature is the first tier with the approval workflow', () => {
    assert.equal(TIER_LIMITS.premium.approvalWorkflow, false);
    assert.equal(TIER_LIMITS.signature.approvalWorkflow, true);
    assert.equal(TIER_LIMITS.group.approvalWorkflow, true);
  });
});

describe('tier limits — outbox gating', () => {
  test('a tenant under its limits may send', () => {
    const d = checkTierSendAllowed('starter', { monthlyUsed: 100, hourlyRecent: 20 });
    assert.equal(d.allowed, true);
  });

  test('Starter is blocked when it exceeds the monthly allowance', () => {
    const d = checkTierSendAllowed('starter', { monthlyUsed: 500, hourlyRecent: 10 });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'monthly_quota_exceeded');
    assert.equal(d.allowance, 500);
    assert.equal(d.used, 500);
  });

  test('Starter is blocked at exactly 100 messages in the hour', () => {
    const d = checkTierSendAllowed('starter', { monthlyUsed: 100, hourlyRecent: 100 });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'hourly_rate_exceeded');
    assert.equal(d.limit, 100);
    assert.equal(d.recent, 100);
  });

  test('a tenant just under the hourly limit is allowed', () => {
    const d = checkTierSendAllowed('starter', { monthlyUsed: 100, hourlyRecent: 99 });
    assert.equal(d.allowed, true);
  });

  test('Group is never blocked by the monthly allowance', () => {
    const d = checkTierSendAllowed('group', { monthlyUsed: 10_000_000, hourlyRecent: 500 });
    assert.equal(d.allowed, true);
  });

  test('Group is still rate limited at its hourly ceiling', () => {
    const d = checkTierSendAllowed('group', { monthlyUsed: 10, hourlyRecent: 2000 });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'hourly_rate_exceeded');
  });

  test('the blocked message is actionable for the dashboard banner', () => {
    const d = checkTierSendAllowed('starter', { monthlyUsed: 500, hourlyRecent: 5 });
    if (!d.allowed) {
      const msg = tierLimitBlockedMessage(d);
      assert.match(msg, /500/);
      assert.match(msg, /renew/i);
    } else {
      assert.fail('expected a blocked decision');
    }
  });
});
