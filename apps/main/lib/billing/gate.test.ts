import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { decideBillingGate, SENDABLE_STATUSES, type BillingTenantLike } from './gate.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-25T10:00:00.000Z');
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * MS_PER_DAY);

describe('decideBillingGate — trial', () => {
  test('trialing tenant with a future trial_ends_at may send', () => {
    const gate = decideBillingGate(
      { planStatus: 'trialing', trialEndsAt: daysFromNow(10) },
      NOW
    );
    assert.equal(gate.allowed, true);
    assert.equal(gate.reason, 'trial_active');
    assert.equal(gate.readOnly, false);
    assert.ok(gate.trialDaysLeft !== null && gate.trialDaysLeft <= 10 && gate.trialDaysLeft >= 9);
  });

  test('trialing tenant whose trial has expired is read-only', () => {
    const gate = decideBillingGate(
      { planStatus: 'trialing', trialEndsAt: daysFromNow(-1) },
      NOW
    );
    assert.equal(gate.allowed, false);
    assert.equal(gate.readOnly, true);
    assert.equal(gate.reason, 'trial_expired');
  });

  test('trialing tenant at exactly now is expired (boundary)', () => {
    const gate = decideBillingGate(
      { planStatus: 'trialing', trialEndsAt: new Date(NOW.getTime()) },
      NOW
    );
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, 'trial_expired');
  });
});

describe('decideBillingGate — subscription', () => {
  test('active tenant with a subscription token may send regardless of trial', () => {
    const gate = decideBillingGate(
      {
        planStatus: 'active',
        trialEndsAt: daysFromNow(-30),
        payfastSubscriptionToken: 'sub-token-xyz',
      },
      NOW
    );
    assert.equal(gate.allowed, true);
    assert.equal(gate.reason, 'subscription_active');
    assert.equal(gate.hasSubscription, true);
  });

  test('active tenant WITHOUT a token and expired trial is read-only', () => {
    const gate = decideBillingGate(
      { planStatus: 'active', trialEndsAt: daysFromNow(-5) },
      NOW
    );
    assert.equal(gate.allowed, false);
    assert.equal(gate.readOnly, true);
  });

  test('active tenant without a token but with a live trial is ALLOWED (payment recorded mid-trial)', () => {
    // Regression: this state previously matched no branch and fell through
    // to the catch-all denial — a customer who paid during their trial was
    // locked out immediately. The payment is recorded (active) and the trial
    // they were granted is still running, so sending must continue.
    const gate = decideBillingGate(
      { planStatus: 'active', trialEndsAt: daysFromNow(7) },
      NOW
    );
    assert.equal(gate.allowed, true);
    assert.equal(gate.readOnly, false);
    assert.equal(gate.reason, 'active_no_token');
    assert.equal(gate.hasSubscription, false);
  });
});

describe('decideBillingGate — past_due / canceled', () => {
  test('past_due tenant is read-only and cannot send', () => {
    const gate = decideBillingGate(
      { planStatus: 'past_due', trialEndsAt: daysFromNow(5) },
      NOW
    );
    assert.equal(gate.allowed, false);
    assert.equal(gate.readOnly, true);
    assert.equal(gate.reason, 'past_due');
  });

  test('canceled tenant is read-only and cannot send even with token', () => {
    const gate = decideBillingGate(
      { planStatus: 'canceled', payfastSubscriptionToken: 'tok' },
      NOW
    );
    assert.equal(gate.allowed, false);
    assert.equal(gate.readOnly, true);
    assert.equal(gate.reason, 'canceled');
  });
});

describe('decideBillingGate — edge cases', () => {
  test('unknown tenant (null) is denied (fail closed)', () => {
    const gate = decideBillingGate(null, NOW);
    assert.equal(gate.allowed, false);
    assert.equal(gate.readOnly, false);
    assert.equal(gate.reason, 'no_token');
  });

  test('undefined tenant is denied', () => {
    const gate = decideBillingGate(undefined, NOW);
    assert.equal(gate.allowed, false);
  });

  test('missing planStatus defaults to trialing behavior', () => {
    const gate = decideBillingGate({ trialEndsAt: daysFromNow(3) }, NOW);
    assert.equal(gate.allowed, true);
    assert.equal(gate.planStatus, 'trialing');
  });

  test('unrecognised planStatus fails closed', () => {
    const gate = decideBillingGate({ planStatus: 'weird' as any }, NOW);
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, 'no_token');
  });

  test('trialDaysLeft is negative once expired', () => {
    const gate = decideBillingGate(
      { planStatus: 'trialing', trialEndsAt: daysFromNow(-3) },
      NOW
    );
    assert.ok(gate.trialDaysLeft !== null && gate.trialDaysLeft <= -2);
  });
});

describe('decideBillingGate — invariants', () => {
  test('SENDABLE_STATUSES contains exactly trialing and active', () => {
    assert.deepEqual(SENDABLE_STATUSES, ['trialing', 'active']);
  });

  test('never both allowed and readOnly', () => {
    const cases: BillingTenantLike[] = [
      { planStatus: 'trialing', trialEndsAt: daysFromNow(10) },
      { planStatus: 'active', payfastSubscriptionToken: 't' },
      { planStatus: 'past_due' },
      { planStatus: 'canceled' },
      { planStatus: 'trialing', trialEndsAt: daysFromNow(-1) },
      {},
    ];
    for (const c of cases) {
      const g = decideBillingGate(c, NOW);
      assert.ok(!(g.allowed && g.readOnly), `allowed&&readOnly for ${JSON.stringify(c)}`);
    }
  });
});
