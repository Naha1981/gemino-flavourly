import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isCronAuthorized } from './authorize.ts';

/**
 * G0.1 regression tests for cron authentication.
 *
 * These exercise the real decision function used by assertCronAuthorized(),
 * which is what every /api/cron/* route calls. See auth.route.test.ts for
 * the companion test proving the routes actually invoke that guard.
 */

const SECRET = 'test-cron-secret-value';

describe('cron auth: server secret missing (fail closed)', () => {
  test('rejects even a well-formed Bearer header when CRON_SECRET is undefined', () => {
    assert.equal(isCronAuthorized(`Bearer ${SECRET}`, undefined), false);
  });

  test('rejects when CRON_SECRET is an empty string', () => {
    assert.equal(isCronAuthorized(`Bearer ${SECRET}`, ''), false);
  });

  test('rejects a request with no credential when CRON_SECRET is undefined', () => {
    assert.equal(isCronAuthorized(null, undefined), false);
  });
});

describe('cron auth: missing credential', () => {
  test('rejects a null Authorization header', () => {
    assert.equal(isCronAuthorized(null, SECRET), false);
  });

  test('rejects an undefined Authorization header', () => {
    assert.equal(isCronAuthorized(undefined, SECRET), false);
  });

  test('rejects an empty Authorization header', () => {
    assert.equal(isCronAuthorized('', SECRET), false);
  });

  test('rejects "Bearer" with no token', () => {
    assert.equal(isCronAuthorized('Bearer ', SECRET), false);
  });
});

describe('cron auth: wrong credential', () => {
  test('rejects an incorrect secret', () => {
    assert.equal(isCronAuthorized('Bearer totally-wrong-secret', SECRET), false);
  });

  test('rejects a correct-prefix partial secret', () => {
    assert.equal(isCronAuthorized(`Bearer ${SECRET.slice(0, -1)}`, SECRET), false);
  });

  test('rejects the secret with trailing whitespace', () => {
    assert.equal(isCronAuthorized(`Bearer ${SECRET} `, SECRET), false);
  });

  test('rejects a raw secret with no Bearer scheme', () => {
    assert.equal(isCronAuthorized(SECRET, SECRET), false);
  });

  test('rejects a different auth scheme carrying the right value', () => {
    assert.equal(isCronAuthorized(`Basic ${SECRET}`, SECRET), false);
  });

  test('is case-sensitive on the Bearer scheme', () => {
    assert.equal(isCronAuthorized(`bearer ${SECRET}`, SECRET), false);
  });
});

describe('cron auth: correct credential', () => {
  test('accepts Authorization: Bearer <CRON_SECRET>', () => {
    assert.equal(isCronAuthorized(`Bearer ${SECRET}`, SECRET), true);
  });

  test('accepts a secret containing regex/URL-special characters', () => {
    const gnarly = 'a+b/c=d.e$f^g|h?i&j=k';
    assert.equal(isCronAuthorized(`Bearer ${gnarly}`, gnarly), true);
  });
});
