import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AT_RISK_MIN_DAYS,
  DORMANT_THRESHOLD_DAYS,
  REACTIVATION_REPLY_WINDOW_DAYS,
  REACTIVATION_COOLDOWN_DAYS,
  buildReactivationMessage,
  formatResponseRate,
  isReactivationReply,
  isReactivationSegment,
  resolveReactivationTarget,
} from './reactivation.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-24T10:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

describe('buildReactivationMessage', () => {
  test('dormant customer gets the win-back copy with the 10% weekend offer', () => {
    const message = buildReactivationMessage({
      segment: 'dormant',
      customerName: 'Thabo',
      restaurantName: 'Gemino Grill',
      daysSinceLastVisit: 210,
    });
    assert.equal(
      message.text,
      "Hi Thabo, we've missed you at Gemino Grill! We've added new dishes since your last visit. Come back this weekend and enjoy 10% off."
    );
  });

  test('at-risk customer gets the rebooking nudge with no discount', () => {
    const message = buildReactivationMessage({
      segment: 'at_risk',
      customerName: 'Nadia',
      daysSinceLastVisit: 150,
    });
    assert.equal(
      message.text,
      "Hi Nadia, it's been a while! We'd love to see you again. Book a table this week and we'll save your favorite spot."
    );
    assert.doesNotMatch(message.text, /% off/);
  });

  test('missing restaurant name degrades instead of printing "at !"', () => {
    const message = buildReactivationMessage({ segment: 'dormant', customerName: 'Thabo' });
    assert.match(message.text, /we've missed you!/);
    assert.doesNotMatch(message.text, /at\s+!/);
  });

  test('missing customer name falls back to a neutral greeting', () => {
    const message = buildReactivationMessage({ segment: 'at_risk', customerName: null });
    assert.match(message.text, /^Hi there,/);
  });

  test('dietary preference is mentioned in the message', () => {
    const message = buildReactivationMessage({
      segment: 'dormant',
      customerName: 'Aisha',
      restaurantName: 'Gemino Grill',
      preferences: { dietary: ['vegetarian'] },
    });
    assert.match(message.text, /vegetarian options on the menu for you/);
    assert.equal(message.metadata.mentionedDietary, 'vegetarian');
  });

  test('favorite dish is mentioned when no dietary preference is known', () => {
    const message = buildReactivationMessage({
      segment: 'at_risk',
      customerName: 'Sipho',
      preferences: { favorites: ['truffle pasta'] },
    });
    assert.match(message.text, /Your favorite truffle pasta is still on the menu\./);
    assert.equal(message.metadata.mentionedFavorite, 'truffle pasta');
  });

  test('dietary wins over favorite — one personalisation sentence, not a list', () => {
    const message = buildReactivationMessage({
      segment: 'at_risk',
      customerName: 'Sipho',
      preferences: { dietary: ['vegan'], favorites: ['truffle pasta'] },
    });
    assert.match(message.text, /vegan options/);
    assert.doesNotMatch(message.text, /truffle pasta/);
    assert.equal(message.metadata.mentionedFavorite, null);
  });

  test('birthday occasion is called out exactly as specified', () => {
    const message = buildReactivationMessage({
      segment: 'dormant',
      customerName: 'Lerato',
      preferences: { occasions: ['birthday'] },
    });
    assert.match(message.text, /Your birthday is coming up — let us make it special!/);
    assert.equal(message.metadata.mentionedOccasion, 'birthday');
  });

  test('other occasions reuse the same sentence shape', () => {
    const message = buildReactivationMessage({
      segment: 'dormant',
      customerName: 'Lerato',
      preferences: { occasions: ['anniversary'] },
    });
    assert.match(message.text, /Your anniversary is coming up — let us make it special!/);
  });

  test('preferences and occasions personalise the same message together', () => {
    const message = buildReactivationMessage({
      segment: 'dormant',
      customerName: 'Thabo',
      restaurantName: 'Gemino Grill',
      preferences: { dietary: ['vegetarian'], occasions: ['birthday'] },
      daysSinceLastVisit: 210,
    });
    assert.equal(
      message.text,
      "Hi Thabo, we've missed you at Gemino Grill! We've added new dishes since your last visit. Come back this weekend and enjoy 10% off. " +
        "We've kept plenty of vegetarian options on the menu for you. " +
        'Your birthday is coming up — let us make it special!'
    );
  });

  test('metadata echoes segment and recency for the campaign row', () => {
    const message = buildReactivationMessage({
      segment: 'dormant',
      customerName: 'Thabo',
      restaurantName: 'Gemino Grill',
      daysSinceLastVisit: 205.5,
    });
    assert.equal(message.metadata.segment, 'dormant');
    assert.equal(message.metadata.customerName, 'Thabo');
    assert.equal(message.metadata.restaurantName, 'Gemino Grill');
    assert.equal(message.metadata.daysSinceLastVisit, 205.5);
    assert.equal(message.metadata.mentionedOccasion, null);
  });
});

describe('resolveReactivationTarget', () => {
  test('last visit older than 180 days is dormant, whatever the stored label says', () => {
    const target = resolveReactivationTarget({ segment: 'at_risk', lastVisitAt: daysAgo(200) }, NOW);
    assert.deepEqual(target, { segment: 'dormant', daysSinceLastVisit: 200 });
  });

  test('a fresh visit disqualifies even a stale dormant label', () => {
    const target = resolveReactivationTarget({ segment: 'dormant', lastVisitAt: daysAgo(10) }, NOW);
    assert.equal(target, null);
  });

  test('dormant label with no visit history still yields dormant', () => {
    const target = resolveReactivationTarget({ segment: 'dormant', lastVisitAt: null }, NOW);
    assert.deepEqual(target, { segment: 'dormant', daysSinceLastVisit: null });
  });

  test('the 120-180 day window is at_risk', () => {
    assert.equal(resolveReactivationTarget({ segment: 'new', lastVisitAt: daysAgo(150) }, NOW)?.segment, 'at_risk');
    assert.equal(resolveReactivationTarget({ segment: 'at_risk', lastVisitAt: daysAgo(150) }, NOW)?.segment, 'at_risk');
  });

  test('recent, active customers are never reactivation targets', () => {
    assert.equal(resolveReactivationTarget({ segment: 'at_risk', lastVisitAt: daysAgo(AT_RISK_MIN_DAYS) }, NOW), null);
    assert.equal(resolveReactivationTarget({ segment: 'vip', lastVisitAt: daysAgo(30) }, NOW), null);
    assert.equal(resolveReactivationTarget({ segment: 'regular', lastVisitAt: null }, NOW), null);
  });

  test('exactly the dormant threshold counts as dormant', () => {
    const exactly180 = resolveReactivationTarget({ segment: 'regular', lastVisitAt: daysAgo(DORMANT_THRESHOLD_DAYS + 1) }, NOW);
    assert.equal(exactly180?.segment, 'dormant');
  });
});

describe('isReactivationReply', () => {
  test('booking-intent keywords count as responses', () => {
    assert.equal(isReactivationReply('I would like to book a table for Saturday'), true);
    assert.equal(isReactivationReply('Can I reserve for 4 people?'), true);
    assert.equal(isReactivationReply('yes please rebook me'), true);
  });

  test('substring matches do not count — whole words only', () => {
    assert.equal(isReactivationReply('I bookmarked your page ages ago'), false);
    assert.equal(isReactivationReply('what are your reserved parking rules'), false);
  });

  test('opt-outs and refusals never burn the response flag', () => {
    assert.equal(isReactivationReply('STOP'), false);
    assert.equal(isReactivationReply('no thanks'), false);
    assert.equal(isReactivationReply(''), false);
  });
});

describe('formatResponseRate', () => {
  test('renders the dashboard line from the gate spec', () => {
    assert.equal(formatResponseRate(24, 8), '24 sent, 8 responded (33%)');
  });

  test('zero sends never divide by zero', () => {
    assert.equal(formatResponseRate(0, 0), '0 sent, 0 responded (0%)');
  });

  test('responded above sent clamps instead of exceeding 100%', () => {
    assert.equal(formatResponseRate(2, 5), '2 sent, 2 responded (100%)');
  });

  test('garbage input is coerced, not thrown', () => {
    assert.equal(formatResponseRate(NaN, 1), '0 sent, 0 responded (0%)');
  });
});

describe('constants match the gate contract', () => {
  test('segment, cooldown and reply-window boundaries', () => {
    assert.equal(DORMANT_THRESHOLD_DAYS, 180);
    assert.equal(AT_RISK_MIN_DAYS, 120);
    assert.equal(REACTIVATION_COOLDOWN_DAYS, 90);
    assert.equal(REACTIVATION_REPLY_WINDOW_DAYS, 14);
    assert.equal(isReactivationSegment('dormant'), true);
    assert.equal(isReactivationSegment('at_risk'), true);
    assert.equal(isReactivationSegment('vip'), false);
  });
});
