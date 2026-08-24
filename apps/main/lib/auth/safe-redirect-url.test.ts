import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getSafeRedirectUrl } from './safe-redirect-url.ts';

const fallback = '/fallback';

describe('getSafeRedirectUrl', () => {
  test('returns fallback for null', () => {
    assert.equal(getSafeRedirectUrl(null, fallback), fallback);
  });

  test('returns fallback for an empty string', () => {
    assert.equal(getSafeRedirectUrl('', fallback), fallback);
  });

  test('allows the root internal path', () => {
    assert.equal(getSafeRedirectUrl('/', fallback), '/');
  });

  test('allows an internal admin path', () => {
    assert.equal(getSafeRedirectUrl('/admin', fallback), '/admin');
  });

  test('allows a nested internal dashboard path', () => {
    assert.equal(getSafeRedirectUrl('/dashboard/inbox', fallback), '/dashboard/inbox');
  });

  test('blocks protocol-relative open redirects', () => {
    assert.equal(getSafeRedirectUrl('//evil.com', fallback), fallback);
  });

  test('blocks external https URLs', () => {
    assert.equal(getSafeRedirectUrl('https://attacker.com', fallback), fallback);
  });
});
