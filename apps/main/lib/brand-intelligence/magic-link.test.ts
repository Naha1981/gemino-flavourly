import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateClaimToken,
  tokenExpiry,
  assessClaimToken,
  assessClaimAttempt,
  buildClaimLink,
  CLAIM_TOKEN_TTL_MS,
} from './magic-link.ts';

const NOW = new Date('2026-08-26T10:00:00.000Z');

const validToken = () => ({
  token: 'abc123',
  tenantId: '00000000-0000-0000-0000-000000000000',
  createdAt: NOW,
  expiresAt: tokenExpiry(NOW),
  claimedAt: null,
  claimedByUserId: null,
});

describe('magic-link — token generation', () => {
  test('produces an opaque, URL-safe token that is not a predictable UUID', () => {
    const t = generateClaimToken();
    assert.ok(t.length >= 40, 'token should be long enough to be unguessable');
    assert.match(t, /^[A-Za-z0-9_-]+$/); // base64url
    assert.ok(!/^[0-9a-f]{8}-/.test(t), 'must not leak a uuid-like prefix');
  });

  test('two generations are distinct', () => {
    assert.notEqual(generateClaimToken(), generateClaimToken());
  });

  test('expiry is 30 days from creation', () => {
    const exp = tokenExpiry(NOW);
    assert.equal(exp.getTime() - NOW.getTime(), CLAIM_TOKEN_TTL_MS);
  });
});

describe('magic-link — claim token assessment', () => {
  test('a fresh, unexpired token is valid', () => {
    assert.deepEqual(assessClaimToken(validToken(), NOW), { kind: 'valid' });
  });

  test('a null token is invalid', () => {
    assert.deepEqual(assessClaimToken(null, NOW), { kind: 'invalid', reason: 'missing' });
  });

  test('a claimed token is reported as already claimed', () => {
    const tok = { ...validToken(), claimedAt: new Date('2026-08-27T00:00:00.000Z'), claimedByUserId: 'user_1' };
    assert.deepEqual(assessClaimToken(tok, NOW), { kind: 'claimed', reason: 'already_claimed' });
  });

  test('an expired token is rejected even if unclaimed', () => {
    const tok = { ...validToken(), expiresAt: new Date(NOW.getTime() - 1000) };
    assert.deepEqual(assessClaimToken(tok, NOW), { kind: 'expired', reason: 'expired' });
  });
});

describe('magic-link — claim idempotency', () => {
  test('a fresh token is claimable', () => {
    const r = assessClaimAttempt(validToken(), 'user_1');
    assert.equal(r.canClaim, true);
    assert.equal(r.outcome, 'fresh_claim');
  });

  test('re-claiming with the SAME user is idempotent (no error)', () => {
    const tok = { ...validToken(), claimedAt: NOW, claimedByUserId: 'user_1' };
    const r = assessClaimAttempt(tok, 'user_1');
    assert.equal(r.canClaim, false);
    assert.equal(r.outcome, 'already_claimed_same_user');
  });

  test('claiming an already-claimed token as a DIFFERENT user is a conflict', () => {
    const tok = { ...validToken(), claimedAt: NOW, claimedByUserId: 'user_1' };
    const r = assessClaimAttempt(tok, 'user_2');
    assert.equal(r.canClaim, false);
    assert.equal(r.outcome, 'already_claimed_other_user');
  });
});

describe('magic-link — link building', () => {
  test('builds the public claim URL against the configured app origin', () => {
    assert.equal(buildClaimLink('xyz', 'https://app.example.com'), 'https://app.example.com/claim/xyz');
    assert.equal(buildClaimLink('xyz', 'https://app.example.com/'), 'https://app.example.com/claim/xyz');
  });
});
