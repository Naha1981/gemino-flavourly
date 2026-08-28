import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isControlFlowError } from './safe-auth-core.ts';

/**
 * Regression for a bug introduced by the outage fix itself.
 *
 * `safeAuth()` wraps `auth()` in try/catch so a misconfigured Clerk cannot
 * 500 the landing page. But Next signals "this route must be dynamic" by
 * THROWING a DynamicServerError when a server component touches `headers`
 * during static prerender — and `auth()` does exactly that. The blanket
 * catch swallowed it, producing on every build:
 *
 *   [safe-auth] auth() failed, treating visitor as signed out: Dynamic
 *   server usage: Route / couldn't be rendered statically because it used
 *   `headers`.
 *
 * Two problems: a false error in every build log, and — if the route were
 * ever prerendered — signed-out HTML baked into the page, silently breaking
 * the signed-in redirect to /dashboard. Control-flow errors must propagate.
 */

describe('safeAuth — Next control-flow errors are recognised, not swallowed', () => {
  test('DynamicServerError is control flow', () => {
    const err: any = new Error("Dynamic server usage: Route / couldn't be rendered statically");
    err.digest = 'DYNAMIC_SERVER_USAGE';
    assert.equal(isControlFlowError(err), true);
  });

  test('redirect control-flow errors are control flow', () => {
    const err: any = new Error('NEXT_REDIRECT');
    err.digest = 'NEXT_REDIRECT;replace;/dashboard;307;';
    assert.equal(isControlFlowError(err), true);
  });

  test('notFound control-flow errors are control flow', () => {
    const err: any = new Error('NEXT_NOT_FOUND');
    err.digest = 'NEXT_NOT_FOUND';
    assert.equal(isControlFlowError(err), true);
  });

  test('a genuine Clerk failure is NOT control flow (still degrades)', () => {
    const err: any = new Error('@clerk/nextjs: Missing publishableKey.');
    assert.equal(isControlFlowError(err), false);
  });

  test('an arbitrary runtime error is NOT control flow', () => {
    assert.equal(isControlFlowError(new Error('connection refused')), false);
  });

  test('non-Error / nullish values are handled without throwing', () => {
    assert.equal(isControlFlowError(undefined), false);
    assert.equal(isControlFlowError(null), false);
    assert.equal(isControlFlowError('a string'), false);
    assert.equal(isControlFlowError({}), false);
  });

  test('a non-string digest is not mistaken for control flow', () => {
    assert.equal(isControlFlowError({ digest: 42 }), false);
    assert.equal(isControlFlowError({ digest: null }), false);
  });

  test('matching is on the digest, not the message (messages are unstable)', () => {
    // A real error that merely mentions the phrase must not be rethrown.
    assert.equal(isControlFlowError(new Error('we logged Dynamic server usage earlier')), false);
  });
});
