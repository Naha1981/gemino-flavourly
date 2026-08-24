import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AT_RISK_MIN_DAYS,
  DORMANT_MIN_DAYS,
  REACTIVATION_COOLDOWN_DAYS,
  REACTIVATION_RESPONSE_WINDOW_DAYS,
  extractReactivationPreferences,
  generateReactivationMessage,
  isReactivationBookingReply,
  isReactivationSegment,
  isWithinCampaignCooldown,
  isWithinResponseWindow,
  resolveReactivationTarget,
} from './reactivation.ts';

const NOW = new Date('2026-08-24T10:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * MS_PER_DAY);

describe('resolveReactivationTarget eligibility', () => {
  test('a last visit 180+ days ago resolves dormant', () => {
    const target = resolveReactivationTarget({ lastVisitAt: daysAgo(200) }, { now: NOW });
    assert.equal(target?.segment, 'dormant');
  });

  test('a last visit between 120 and 180 days ago resolves at_risk', () => {
    const target = resolveReactivationTarget({ lastVisitAt: daysAgo(150) }, { now: NOW });
    assert.equal(target?.segment, 'at_risk');
  });

  test('a visit within 120 days is not eligible', () => {
    for (const days of [0, 10, 119, 120]) {
      assert.equal(
        resolveReactivationTarget({ lastVisitAt: daysAgo(days) }, { now: NOW }),
        null,
        `expected ${days} days to be ineligible`
      );
    }
  });

  test('exactly 180 days is dormant (the "180+ days" boundary)', () => {
    assert.equal(resolveReactivationTarget({ lastVisitAt: daysAgo(180) }, { now: NOW })?.segment, 'dormant');
  });

  test('a stale stored dormant label never beats a fresh visit date', () => {
    // The segmentation cron stamped this profile dormant, but the customer
    // walked in 10 days ago. The visit date is the truth.
    assert.equal(
      resolveReactivationTarget({ lastVisitAt: daysAgo(10), segment: 'dormant' }, { now: NOW }),
      null
    );
  });

  test('a stale stored at_risk label upgrades to dormant when the visit is 200 days old', () => {
    assert.equal(
      resolveReactivationTarget({ lastVisitAt: daysAgo(200), segment: 'at_risk' }, { now: NOW })?.segment,
      'dormant'
    );
  });

  test('no visit date falls back to the stored win-back label', () => {
    assert.equal(resolveReactivationTarget({ segment: 'dormant' }, { now: NOW })?.segment, 'dormant');
    assert.equal(resolveReactivationTarget({ segment: 'at_risk' }, { now: NOW })?.segment, 'at_risk');
  });

  test('no visit date and no win-back label is not eligible', () => {
    assert.equal(resolveReactivationTarget({ segment: 'new' }, { now: NOW }), null);
    assert.equal(resolveReactivationTarget({ segment: 'vip' }, { now: NOW }), null);
    assert.equal(resolveReactivationTarget({}, { now: NOW }), null);
  });

  test('snake_case row shapes are accepted', () => {
    const target = resolveReactivationTarget(
      { last_visit_at: daysAgo(150).toISOString(), stored_segment: 'at_risk' } as any,
      { now: NOW }
    );
    assert.equal(target?.segment, 'at_risk');
    assert.ok((target?.daysSinceVisit ?? 0) > 149 && (target?.daysSinceVisit ?? 0) < 151);
  });

  test('window constants stay aligned with the segmentation gates', () => {
    assert.equal(AT_RISK_MIN_DAYS, 120);
    assert.equal(DORMANT_MIN_DAYS, 180);
    assert.ok(isReactivationSegment('dormant') && isReactivationSegment('at_risk'));
    assert.ok(!isReactivationSegment('vip') && !isReactivationSegment(null));
  });
});

describe('generateReactivationMessage copy', () => {
  test('dormant copy names the restaurant, the new dishes, and the 10% offer', () => {
    const result = generateReactivationMessage({
      segment: 'dormant',
      customerName: 'Thabo',
      restaurantName: 'Flavourly',
    });
    assert.equal(
      result.messageText,
      "Hi Thabo, we've missed you at Flavourly! We've added new dishes since your last visit. Come back this weekend and enjoy 10% off."
    );
    assert.deepEqual(result.metadata, {
      greetedName: 'Thabo',
      restaurantName: 'Flavourly',
      mentionedPreferences: [],
      mentionedOccasion: null,
      offer: '10% off',
    });
  });

  test('at-risk copy offers the favorite spot without a discount', () => {
    const result = generateReactivationMessage({
      segment: 'at_risk',
      customerName: 'Anna',
      restaurantName: 'Flavourly',
    });
    assert.equal(
      result.messageText,
      "Hi Anna, it's been a while! We'd love to see you again. Book a table this week and we'll save your favorite spot."
    );
    assert.equal(result.metadata.offer, null);
    assert.equal(result.metadata.restaurantName, 'Flavourly');
  });

  test('falls back to "there" without a name and drops the restaurant clause', () => {
    const dormant = generateReactivationMessage({ segment: 'dormant' });
    assert.match(dormant.messageText, /^Hi there, we've missed you!/);
    assert.equal(dormant.metadata.restaurantName, null);
    assert.equal(dormant.metadata.greetedName, 'there');
  });

  test('mentions a vegetarian preference', () => {
    const result = generateReactivationMessage({
      segment: 'at_risk',
      customerName: 'Lerato',
      preferences: { dietary: ['vegetarian'], occasions: [] },
    });
    assert.match(result.messageText, /your favorite vegetarian dishes are still on the menu/);
    assert.deepEqual(result.metadata.mentionedPreferences, ['vegetarian']);
  });

  test('mentions an upcoming birthday with the exact sentence', () => {
    const result = generateReactivationMessage({
      segment: 'at_risk',
      customerName: 'Lerato',
      preferences: { dietary: [], occasions: ['birthday'] },
    });
    assert.ok(result.messageText.endsWith('Your birthday is coming up — let us make it special!'));
    assert.equal(result.metadata.mentionedOccasion, 'birthday');
  });

  test('combines preference and occasion personalization with the base copy', () => {
    const result = generateReactivationMessage({
      segment: 'dormant',
      customerName: 'Thabo',
      restaurantName: 'Flavourly',
      preferences: { dietary: ['vegetarian'], occasions: ['anniversary'] },
    });
    assert.equal(
      result.messageText,
      "Hi Thabo, we've missed you at Flavourly! We've added new dishes since your last visit. Come back this weekend and enjoy 10% off. And yes — your favorite vegetarian dishes are still on the menu. Your anniversary is coming up — let us make it special!"
    );
  });

  test('joins at most two dietary tags and one occasion, so copy stays short', () => {
    const result = generateReactivationMessage({
      segment: 'dormant',
      customerName: 'Sam',
      preferences: { dietary: ['vegan', 'gluten-free', 'halal'], occasions: ['birthday', 'date night'] },
    });
    assert.match(result.messageText, /vegan and gluten-free/);
    assert.doesNotMatch(result.messageText, /halal/);
    assert.doesNotMatch(result.messageText, /date night/);
    assert.equal(result.metadata.mentionedOccasion, 'birthday');
  });

  test('ignores malformed preferences shapes instead of throwing', () => {
    for (const preferences of [null, undefined, 'vegetarian', 42, { dietary: 'vegetarian' }, { dietary: [null, 7, '  '] }]) {
      const result = generateReactivationMessage({ segment: 'dormant', preferences });
      assert.deepEqual(result.metadata.mentionedPreferences, []);
      assert.equal(result.metadata.mentionedOccasion, null);
    }
  });

  test('extractReactivationPreferences normalizes case and whitespace', () => {
    assert.deepEqual(
      extractReactivationPreferences({ dietary: [' Vegetarian ', 'VEGAN'], occasions: ['Birthday'] }),
      { dietary: ['vegetarian', 'vegan'], occasions: ['birthday'] }
    );
    assert.deepEqual(extractReactivationPreferences(undefined), { dietary: [], occasions: [] });
  });
});

describe('cooldown and response windows', () => {
  test('the 90-day cooldown binds inside the window and releases at the boundary', () => {
    assert.equal(isWithinCampaignCooldown(daysAgo(89), NOW), true);
    assert.equal(isWithinCampaignCooldown(daysAgo(30), NOW), true);
    assert.equal(isWithinCampaignCooldown(daysAgo(90), NOW), false);
    assert.equal(isWithinCampaignCooldown(daysAgo(120), NOW), false);
    assert.equal(REACTIVATION_COOLDOWN_DAYS, 90);
  });

  test('a future sent_at (clock skew) is not treated as inside the cooldown', () => {
    assert.equal(isWithinCampaignCooldown(daysAgo(-5), NOW), false);
  });

  test('the 30-day response window attributes replies to recent campaigns only', () => {
    assert.equal(isWithinResponseWindow(daysAgo(2), NOW), true);
    assert.equal(isWithinResponseWindow(daysAgo(29), NOW), true);
    assert.equal(isWithinResponseWindow(daysAgo(31), NOW), false);
    assert.equal(REACTIVATION_RESPONSE_WINDOW_DAYS, 30);
  });

  test('booking replies are detected by keyword, any-casing, word-bounded', () => {
    for (const text of ['Can I book a table?', 'RESERVE for 4 please', 'reservation tomorrow night', 'a table for two']) {
      assert.ok(isReactivationBookingReply(text), `expected "${text}" to look like a booking`);
    }
    assert.ok(!isReactivationBookingReply('no thanks'));
    assert.ok(!isReactivationBookingReply('facebook'));
    assert.ok(!isReactivationBookingReply(''));
  });
});
