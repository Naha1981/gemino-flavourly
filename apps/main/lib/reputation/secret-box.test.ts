import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, isSecretReadable } from './secret-box.ts';

const ORIGINAL_KEY = process.env.REPUTATION_ENCRYPTION_KEY;

describe('secret-box (Gate #11 at-rest key protection)', () => {
  beforeEach(() => {
    process.env.REPUTATION_ENCRYPTION_KEY = 'test-master-secret';
  });

  test('round-trips a Google API key without ever storing plaintext', () => {
    const stored = encryptSecret('AIzaSyD-fake-google-key-123');
    assert.ok(!stored.includes('AIzaSyD-fake-google-key-123'));
    assert.match(stored, /^v1:/);
    assert.equal(decryptSecret(stored), 'AIzaSyD-fake-google-key-123');
    assert.equal(isSecretReadable(stored), true);
  });

  test('every encryption uses a fresh IV (identical inputs, different ciphertexts)', () => {
    const a = encryptSecret('same-secret');
    const b = encryptSecret('same-secret');
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a), 'same-secret');
    assert.equal(decryptSecret(b), 'same-secret');
  });

  test('tampered ciphertext fails authentication and returns null', () => {
    const stored = encryptSecret('top-secret');
    const parts = stored.split(':');
    const flippedByte = Buffer.from(parts[3], 'base64');
    flippedByte[0] ^= 0xff;
    parts[3] = flippedByte.toString('base64');
    assert.equal(decryptSecret(parts.join(':')), null);
    assert.equal(isSecretReadable(parts.join(':')), false);
  });

  test('a rotated/absent master key yields null, never garbage', () => {
    const stored = encryptSecret('rotated-secret');
    process.env.REPUTATION_ENCRYPTION_KEY = 'a-different-master-key';
    assert.equal(decryptSecret(stored), null);

    delete process.env.REPUTATION_ENCRYPTION_KEY;
    assert.equal(decryptSecret(stored), null);
  });

  test('without a master key, secrets degrade to an explicit plain: prefix', () => {
    delete process.env.REPUTATION_ENCRYPTION_KEY;
    const stored = encryptSecret('legacy-key');
    assert.match(stored, /^plain:/);
    assert.equal(decryptSecret(stored), 'legacy-key');
  });

  test('empty/null stored values return null', () => {
    assert.equal(decryptSecret(null), null);
    assert.equal(decryptSecret(undefined), null);
    assert.equal(decryptSecret(''), null);
  });
});

// Restore the environment for other test files in this process.
process.on('exit', () => {
  if (ORIGINAL_KEY === undefined) delete process.env.REPUTATION_ENCRYPTION_KEY;
  else process.env.REPUTATION_ENCRYPTION_KEY = ORIGINAL_KEY;
});
