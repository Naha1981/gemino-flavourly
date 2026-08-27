import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, deriveWrappingKey, resolveCronJobApiKey } from './key-store.ts';
import { cronExpression } from './canonical-fleet.ts';

const SECRET = 'test-cron-secret';

describe('cron key-store — encryption', () => {
  test('round-trips a secret through encrypt/decrypt', () => {
    const cipher = encryptSecret('my-cronjob-api-key', SECRET);
    assert.notEqual(cipher, 'my-cronjob-api-key');
    assert.match(cipher, /^enc:v1:/);
    assert.equal(decryptSecret(cipher, SECRET), 'my-cronjob-api-key');
  });

  test('ciphertexts differ per call (random IV)', () => {
    const a = encryptSecret('same-key', SECRET);
    const b = encryptSecret('same-key', SECRET);
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a, SECRET), decryptSecret(b, SECRET));
  });

  test('fails closed: wrong wrapping key returns null, never garbage', () => {
    const cipher = encryptSecret('my-key', SECRET);
    assert.equal(decryptSecret(cipher, 'other-secret'), null);
  });

  test('fails closed: tampered payloads return null', () => {
    const cipher = encryptSecret('my-key', SECRET);
    const parts = cipher.split(':');
    const tampered = [parts[0], parts[1], parts[2], 'AAAA' + parts[3].slice(4)].join(':');
    assert.equal(decryptSecret(tampered, SECRET), null);
    assert.equal(decryptSecret('garbage', SECRET), null);
    assert.equal(decryptSecret('', SECRET), null);
    assert.equal(decryptSecret(null, SECRET), null);
    assert.equal(decryptSecret(undefined, SECRET), null);
  });

  test('refuses to encrypt without a wrapping secret or an empty key', () => {
    assert.throws(() => encryptSecret('x', undefined), /CRON_SECRET/);
    assert.throws(() => encryptSecret('', SECRET), /empty/);
  });

  test('wrapping key derivation is deterministic and 32 bytes', () => {
    const a = deriveWrappingKey(SECRET);
    const b = deriveWrappingKey(SECRET);
    assert.equal(a.length, 32);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, deriveWrappingKey('different'));
  });
});

describe('cron key-store — resolution policy (database first)', () => {
  const cipher = encryptSecret('db-key', SECRET);

  test('database beats environment', () => {
    const r = resolveCronJobApiKey({ storedCipher: cipher, cronSecret: SECRET, envKey: 'env-key' });
    assert.equal(r.key, 'db-key');
    assert.equal(r.source, 'database');
  });

  test('environment fallback when nothing stored', () => {
    const r = resolveCronJobApiKey({ storedCipher: null, cronSecret: SECRET, envKey: 'env-key' });
    assert.equal(r.key, 'env-key');
    assert.equal(r.source, 'environment');
  });

  test('environment fallback when the stored value is undecryptable', () => {
    const r = resolveCronJobApiKey({ storedCipher: 'enc:v1:corrupt', cronSecret: SECRET, envKey: 'env-key' });
    assert.equal(r.key, 'env-key');
    assert.equal(r.source, 'environment');
  });

  test('environment fallback when CRON_SECRET cannot decrypt (key rotation)', () => {
    const r = resolveCronJobApiKey({ storedCipher: cipher, cronSecret: 'rotated-secret', envKey: 'env-key' });
    assert.equal(r.key, 'env-key');
    assert.equal(r.source, 'environment');
  });

  test('none when neither source has a key', () => {
    const r = resolveCronJobApiKey({ storedCipher: null, cronSecret: SECRET, envKey: undefined });
    assert.equal(r.key, null);
    assert.equal(r.source, 'none');
  });

  test('whitespace-only env key counts as absent', () => {
    const r = resolveCronJobApiKey({ storedCipher: null, cronSecret: SECRET, envKey: '   ' });
    assert.equal(r.key, null);
    assert.equal(r.source, 'none');
  });
});

describe('cron fleet — cronExpression rendering', () => {
  test('every-minute job renders */star fields', () => {
    const expr = cronExpression({ mdays: [-1], months: [-1], wdays: [-1], hours: [-1], minutes: [0, 15, 30, 45], timezone: 'x', expiresAt: 0 });
    assert.equal(expr, '0,15,30,45 * * * *');
  });

  test('fixed-hour job renders minute + hours', () => {
    const expr = cronExpression({ mdays: [-1], months: [-1], wdays: [-1], hours: [7], minutes: [0], timezone: 'x', expiresAt: 0 });
    assert.equal(expr, '0 7 * * *');
  });

  test('weekday-bounded job renders the dow field', () => {
    const expr = cronExpression({ mdays: [-1], months: [-1], wdays: [1], hours: [8], minutes: [0], timezone: 'x', expiresAt: 0 });
    assert.equal(expr, '0 8 * * 1');
  });

  test('hourly watchdog renders 0 * * * *', () => {
    const expr = cronExpression({ mdays: [-1], months: [-1], wdays: [-1], hours: [-1], minutes: [0], timezone: 'x', expiresAt: 0 });
    assert.equal(expr, '0 * * * *');
  });
});
