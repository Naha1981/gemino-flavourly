import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findDispatchBlocker,
  resolveDispatchOutcome,
  dispatchHttpStatus,
} from './dispatch.ts';

/**
 * G0.3 tests for outbound dispatch decisions.
 *
 * The invariant under test, stated once: a message that was not
 * dispatched and was not queued must NEVER be reported as sent.
 */

describe('findDispatchBlocker', () => {
  test('blocks when waAccountId is null (the silent-drop bug)', () => {
    assert.notEqual(findDispatchBlocker(null), null);
  });

  test('blocks when waAccountId is undefined', () => {
    assert.notEqual(findDispatchBlocker(undefined), null);
  });

  test('blocks when waAccountId is an empty or whitespace string', () => {
    assert.notEqual(findDispatchBlocker(''), null);
    assert.notEqual(findDispatchBlocker('   '), null);
  });

  test('allows a real account id', () => {
    assert.equal(findDispatchBlocker('4d1f0c9e-0000-4000-8000-000000000001'), null);
  });

  test('the blocker message is actionable and leaks nothing', () => {
    const msg = findDispatchBlocker(null)!;
    assert.match(msg, /WhatsApp/i);
    assert.match(msg, /Settings|Reconnect/i);
  });
});

describe('resolveDispatchOutcome', () => {
  test('a blocked message is failed and NOT accepted', () => {
    const o = resolveDispatchOutcome({
      blocker: 'no account',
      directSendSucceeded: false,
      queuedForRetry: false,
    });
    assert.equal(o.status, 'failed');
    assert.equal(o.accepted, false);
  });

  test('a blocker wins even if something claims the send succeeded', () => {
    // Defensive: an undispatchable message must never be reported sent,
    // regardless of what the other flags say.
    const o = resolveDispatchOutcome({
      blocker: 'no account',
      directSendSucceeded: true,
      queuedForRetry: true,
    });
    assert.equal(o.status, 'failed');
    assert.equal(o.accepted, false);
  });

  test('a successful direct send is sent and accepted', () => {
    const o = resolveDispatchOutcome({
      blocker: null,
      directSendSucceeded: true,
      queuedForRetry: false,
    });
    assert.equal(o.status, 'sent');
    assert.equal(o.accepted, true);
  });

  test('a failed send that was queued is queued and accepted, never sent', () => {
    const o = resolveDispatchOutcome({
      blocker: null,
      directSendSucceeded: false,
      queuedForRetry: true,
      error: 'Operator unreachable',
    });
    assert.equal(o.status, 'queued');
    assert.equal(o.accepted, true);
    assert.notEqual(o.status, 'sent');
  });

  test('a failed send that could NOT be queued is failed and not accepted', () => {
    const o = resolveDispatchOutcome({
      blocker: null,
      directSendSucceeded: false,
      queuedForRetry: false,
      error: 'Operator unreachable',
    });
    assert.equal(o.status, 'failed');
    assert.equal(o.accepted, false);
    assert.match(o.error!, /Operator unreachable/);
  });

  test('a failure always carries an explanation for staff', () => {
    const o = resolveDispatchOutcome({
      blocker: null,
      directSendSucceeded: false,
      queuedForRetry: false,
    });
    assert.ok(o.error && o.error.length > 0);
  });

  test('exhaustive: only a real send or a real queue is ever accepted', () => {
    for (const blocker of [null, 'blocked']) {
      for (const direct of [true, false]) {
        for (const queued of [true, false]) {
          const o = resolveDispatchOutcome({
            blocker,
            directSendSucceeded: direct,
            queuedForRetry: queued,
          });
          const shouldAccept = !blocker && (direct || queued);
          assert.equal(
            o.accepted,
            shouldAccept,
            `blocker=${blocker} direct=${direct} queued=${queued}`
          );
          if (!shouldAccept) assert.equal(o.status, 'failed');
          // 'sent' is reserved for a confirmed dispatch.
          if (o.status === 'sent') assert.ok(!blocker && direct);
        }
      }
    }
  });
});

describe('dispatchHttpStatus', () => {
  test('an undelivered message does not return 200', () => {
    const o = resolveDispatchOutcome({
      blocker: 'no account',
      directSendSucceeded: false,
      queuedForRetry: false,
    });
    assert.notEqual(dispatchHttpStatus(o), 200);
    assert.equal(dispatchHttpStatus(o), 502);
  });

  test('an accepted message returns 200', () => {
    for (const o of [
      resolveDispatchOutcome({ blocker: null, directSendSucceeded: true, queuedForRetry: false }),
      resolveDispatchOutcome({ blocker: null, directSendSucceeded: false, queuedForRetry: true }),
    ]) {
      assert.equal(dispatchHttpStatus(o), 200);
    }
  });
});
