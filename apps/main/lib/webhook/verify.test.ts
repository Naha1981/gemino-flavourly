import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { verifyWebhookSignature } from './verify.ts';

/**
 * G0.1 regression tests for inbound webhook HMAC verification.
 *
 * The environment is injected rather than mutated globally so these tests
 * are order-independent and cannot leak state into each other.
 */

const SECRET = 'test-webhook-secret';
const BODY = JSON.stringify({ waAccountId: 'acc-1', message: { key: { id: 'M1' } } });

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

const prodEnv = { WEBHOOK_SECRET: SECRET, NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv;

describe('webhook: valid signature', () => {
  test('accepts a correctly signed payload', () => {
    assert.equal(verifyWebhookSignature(BODY, sign(BODY), prodEnv), true);
  });

  test('accepts an uppercase-hex signature', () => {
    assert.equal(verifyWebhookSignature(BODY, sign(BODY).toUpperCase(), prodEnv), true);
  });

  test('accepts an empty body that is correctly signed', () => {
    assert.equal(verifyWebhookSignature('', sign(''), prodEnv), true);
  });
});

describe('webhook: missing signature', () => {
  test('rejects a null signature', () => {
    assert.equal(verifyWebhookSignature(BODY, null, prodEnv), false);
  });

  test('rejects an undefined signature', () => {
    assert.equal(verifyWebhookSignature(BODY, undefined, prodEnv), false);
  });

  test('rejects an empty-string signature', () => {
    assert.equal(verifyWebhookSignature(BODY, '', prodEnv), false);
  });
});

describe('webhook: invalid signature', () => {
  test('rejects a signature computed with the wrong secret', () => {
    assert.equal(verifyWebhookSignature(BODY, sign(BODY, 'attacker-secret'), prodEnv), false);
  });

  test('rejects a non-hex signature', () => {
    assert.equal(verifyWebhookSignature(BODY, 'not-a-hex-signature!!', prodEnv), false);
  });

  test('rejects a truncated signature', () => {
    assert.equal(verifyWebhookSignature(BODY, sign(BODY).slice(0, 32), prodEnv), false);
  });

  test('rejects a signature with one byte flipped', () => {
    const s = sign(BODY);
    const flipped = (s[0] === 'a' ? 'b' : 'a') + s.slice(1);
    assert.equal(verifyWebhookSignature(BODY, flipped, prodEnv), false);
  });
});

describe('webhook: modified payload', () => {
  test('rejects when the body is altered after signing', () => {
    const signature = sign(BODY);
    const tampered = JSON.stringify({ waAccountId: 'acc-ATTACKER', message: { key: { id: 'M1' } } });
    assert.equal(verifyWebhookSignature(tampered, signature, prodEnv), false);
  });

  test('rejects a single-whitespace change to the body', () => {
    assert.equal(verifyWebhookSignature(BODY + ' ', sign(BODY), prodEnv), false);
  });
});

describe('webhook: missing WEBHOOK_SECRET must fail closed', () => {
  test('rejects in production when the secret is unset', () => {
    const env = { NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv;
    assert.equal(verifyWebhookSignature(BODY, sign(BODY), env), false);
  });

  test('rejects an unsigned request in production when the secret is unset', () => {
    const env = { NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv;
    assert.equal(verifyWebhookSignature(BODY, null, env), false);
  });

  test('rejects when NODE_ENV is UNSET and the secret is unset (the old bypass defaulted OPEN here)', () => {
    assert.equal(verifyWebhookSignature(BODY, null, {} as NodeJS.ProcessEnv), false);
  });

  test("rejects when NODE_ENV='development' and the secret is unset, without the explicit opt-in", () => {
    const env = { NODE_ENV: 'development' } as unknown as NodeJS.ProcessEnv;
    assert.equal(verifyWebhookSignature(BODY, null, env), false);
  });

  test("rejects when NODE_ENV='test' and the secret is unset", () => {
    const env = { NODE_ENV: 'test' } as unknown as NodeJS.ProcessEnv;
    assert.equal(verifyWebhookSignature(BODY, null, env), false);
  });
});

describe('webhook: local-dev escape hatch is narrow and production-proof', () => {
  test('allows unsigned requests only with the explicit opt-in, outside production', () => {
    const env = {
      NODE_ENV: 'development',
      ALLOW_UNSIGNED_WEBHOOKS: 'true',
    } as unknown as NodeJS.ProcessEnv;
    assert.equal(verifyWebhookSignature(BODY, null, env), true);
  });

  test('the opt-in is IGNORED when NODE_ENV=production', () => {
    const env = {
      NODE_ENV: 'production',
      ALLOW_UNSIGNED_WEBHOOKS: 'true',
    } as unknown as NodeJS.ProcessEnv;
    assert.equal(verifyWebhookSignature(BODY, null, env), false);
  });

  test('the opt-in is IGNORED when VERCEL_ENV=production', () => {
    const env = {
      VERCEL_ENV: 'production',
      ALLOW_UNSIGNED_WEBHOOKS: 'true',
    } as unknown as NodeJS.ProcessEnv;
    assert.equal(verifyWebhookSignature(BODY, null, env), false);
  });

  test('a non-"true" value does not enable the opt-in', () => {
    for (const v of ['1', 'yes', 'TRUE', '']) {
      const env = {
        NODE_ENV: 'development',
        ALLOW_UNSIGNED_WEBHOOKS: v,
      } as unknown as NodeJS.ProcessEnv;
      assert.equal(verifyWebhookSignature(BODY, null, env), false, `value ${JSON.stringify(v)}`);
    }
  });

  test('the opt-in does NOT bypass verification when a secret IS configured', () => {
    const env = {
      NODE_ENV: 'development',
      ALLOW_UNSIGNED_WEBHOOKS: 'true',
      WEBHOOK_SECRET: SECRET,
    } as unknown as NodeJS.ProcessEnv;
    // A bad signature is still rejected even with the escape hatch on.
    assert.equal(verifyWebhookSignature(BODY, sign(BODY, 'wrong'), env), false);
    assert.equal(verifyWebhookSignature(BODY, null, env), false);
    // ...and a good one is still accepted.
    assert.equal(verifyWebhookSignature(BODY, sign(BODY), env), true);
  });
});
