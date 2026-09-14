import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATED_SEND_END_MINUTE,
  AUTOMATED_SEND_START_MINUTE,
  isWithinAutomatedSendWindow,
  nextAutomatedSendWindow,
} from './quiet-hours.ts';

describe('automated WhatsApp send window', () => {
  test('allows 07:00 through 19:59 SAST', () => {
    assert.equal(isWithinAutomatedSendWindow(new Date('2026-09-14T04:59:00.000Z')), false);
    assert.equal(isWithinAutomatedSendWindow(new Date('2026-09-14T05:00:00.000Z')), true);
    assert.equal(isWithinAutomatedSendWindow(new Date('2026-09-14T17:59:00.000Z')), true);
    assert.equal(AUTOMATED_SEND_START_MINUTE, 420);
    assert.equal(AUTOMATED_SEND_END_MINUTE, 1200);
  });

  test('blocks 20:00 through 06:59 SAST', () => {
    assert.equal(isWithinAutomatedSendWindow(new Date('2026-09-14T18:00:00.000Z')), false);
    assert.equal(isWithinAutomatedSendWindow(new Date('2026-09-14T02:59:00.000Z')), false);
  });

  test('defers evening jobs to next-day 07:00 SAST', () => {
    const next = nextAutomatedSendWindow(new Date('2026-09-14T21:30:00.000Z'));
    assert.equal(next.toISOString(), '2026-09-15T05:00:00.000Z');
  });

  test('defers pre-window jobs to same-day 07:00 SAST', () => {
    const next = nextAutomatedSendWindow(new Date('2026-09-14T03:30:00.000Z'));
    assert.equal(next.toISOString(), '2026-09-14T05:00:00.000Z');
  });
});
