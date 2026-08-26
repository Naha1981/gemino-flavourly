import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysUntilNextBirthday,
  isBirthdayInWindow,
  buildBirthdayReward,
  selectBirthdayRewards,
  BIRTHDAY_WINDOW_DAYS,
  type BirthdayContactLike,
} from './birthday-rewards.ts';

/** Thursday 26 Aug 2026. */
const NOW = new Date('2026-08-26T10:00:00.000Z');

function contact(partial: Partial<BirthdayContactLike>): BirthdayContactLike {
  return {
    customerPhone: '+27111111111',
    customerName: 'Thandi',
    birthday: null,
    ...partial,
  };
}

describe('birthday rewards — window detection', () => {
  test('a birthday today is 0 days away and in-window', () => {
    // 2026-08-26
    assert.equal(daysUntilNextBirthday('08-26', NOW), 0);
    assert.equal(isBirthdayInWindow(contact({ birthday: '08-26' }), NOW), true);
  });

  test('a birthday 3 days ahead is in-window', () => {
    assert.equal(daysUntilNextBirthday('08-29', NOW), 3);
    assert.equal(isBirthdayInWindow(contact({ birthday: '08-29' }), NOW), true);
  });

  test('a birthday beyond the 7-day window is excluded (null)', () => {
    assert.equal(daysUntilNextBirthday('09-10', NOW), null);
    assert.equal(isBirthdayInWindow(contact({ birthday: '09-10' }), NOW), false);
  });

  test('the window is exactly the configured 7 days', () => {
    assert.equal(BIRTHDAY_WINDOW_DAYS, 7);
    assert.equal(daysUntilNextBirthday('08-26', NOW), 0);
    assert.equal(daysUntilNextBirthday('09-02', NOW), 7); // last in-window day
    assert.equal(daysUntilNextBirthday('09-03', NOW), null); // 8 days — outside
  });

  test('a birthday rolled into next year is still detected (Dec → Jan wrap)', () => {
    const dec = new Date('2026-12-30T10:00:00.000Z');
    // Birthday 2027-01-02 is 3 days after 2026-12-30.
    assert.equal(daysUntilNextBirthday('01-02', dec), 3);
    assert.equal(isBirthdayInWindow(contact({ birthday: '01-02' }), dec), true);
  });

  test('missing or malformed birthdays are excluded', () => {
    assert.equal(isBirthdayInWindow(contact({ birthday: null }), NOW), false);
    assert.equal(daysUntilNextBirthday('banana', NOW), null);
    assert.equal(daysUntilNextBirthday('13-99', NOW), null);
  });

  test('a blocklisted (opted-out) contact is never targeted', () => {
    assert.equal(isBirthdayInWindow(contact({ birthday: '08-27', blocklisted: true }), NOW), false);
  });
});

describe('birthday rewards — offer generation', () => {
  test('builds a personalised WhatsApp offer for an in-window birthday', () => {
    const reward = buildBirthdayReward(contact({ customerName: 'Thandi', birthday: '08-27' }), NOW)!;
    assert.ok(reward, 'expected a reward');
    assert.equal(reward.daysUntilBirthday, 1);
    assert.match(reward.message, /Thandi/);
    assert.match(reward.message, /dessert/i);
    assert.match(reward.message, /BOOK/);
  });

  test('returns null for a contact outside the window', () => {
    assert.equal(buildBirthdayReward(contact({ birthday: '09-20' }), NOW), null);
    assert.equal(buildBirthdayReward(contact({ birthday: null }), NOW), null);
  });
});

describe('birthday rewards — dedup & selection', () => {
  test('selectBirthdayRewards targets one reward per unique in-window contact', () => {
    const rewards = selectBirthdayRewards([
      contact({ id: 'a', customerPhone: '+271', customerName: 'Thandi', birthday: '08-27' }),
      contact({ id: 'b', customerPhone: '+272', customerName: 'Sipho', birthday: '08-29' }),
      contact({ id: 'c', customerPhone: '+273', customerName: 'Out', birthday: '09-20' }),
    ], NOW);
    assert.equal(rewards.length, 2);
    assert.deepEqual(rewards.map((r) => r.customerName).sort(), ['Sipho', 'Thandi']);
  });

  test('skips duplicates on the same phone number', () => {
    const rewards = selectBirthdayRewards([
      contact({ id: 'a', customerPhone: '+271', customerName: 'A', birthday: '08-27' }),
      contact({ id: 'b', customerPhone: '+271', customerName: 'B', birthday: '08-27' }),
    ], NOW);
    assert.equal(rewards.length, 1);
  });
});
