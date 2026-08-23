import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_ENV_VARS,
  findMissingEnvVars,
  formatMissingEnvError,
  validateConfig,
} from '../src/config.ts';

/**
 * G0.2 tests for the operator's boot-time configuration contract.
 *
 * These live in operator/test/ rather than operator/src/ because the
 * operator's tsconfig emits to dist/ with rootDir=src, and the runtime
 * test imports need a '.ts' specifier that an emitting build rejects
 * (TS5097). Keeping them out of src/ leaves `npm run build` untouched.
 *
 * The environment is passed in explicitly, so no test mutates
 * process.env and the order of execution cannot matter.
 */

// A representative "fully configured" environment. Values are obvious
// non-secret placeholders — no real credential appears in this repo.
const VALID_ENV = {
  DATABASE_URL: 'postgresql://user:placeholder@localhost:5432/db',
  WEBHOOK_SECRET: 'placeholder-webhook-secret',
  OPERATOR_API_KEY: 'placeholder-operator-api-key',
} as unknown as NodeJS.ProcessEnv;

describe('required variable set', () => {
  test('covers exactly the three variables the operator cannot run without', () => {
    assert.deepEqual([...REQUIRED_ENV_VARS].sort(), [
      'DATABASE_URL',
      'OPERATOR_API_KEY',
      'WEBHOOK_SECRET',
    ]);
  });
});

describe('valid configuration', () => {
  test('a fully configured environment passes', () => {
    const result = validateConfig(VALID_ENV);
    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.equal(result.error, undefined);
  });

  test('unrelated extra variables do not affect the result', () => {
    const env = { ...VALID_ENV, LOG_LEVEL: 'debug', PORT: '3001' } as NodeJS.ProcessEnv;
    assert.equal(validateConfig(env).ok, true);
  });
});

describe('missing variables', () => {
  for (const name of REQUIRED_ENV_VARS) {
    test(`rejects when ${name} is absent`, () => {
      const env = { ...VALID_ENV } as Record<string, string>;
      delete env[name];
      const result = validateConfig(env as unknown as NodeJS.ProcessEnv);
      assert.equal(result.ok, false);
      assert.deepEqual(result.missing, [name]);
    });
  }

  test('reports every missing variable, not just the first', () => {
    const result = validateConfig({} as NodeJS.ProcessEnv);
    assert.equal(result.ok, false);
    assert.deepEqual([...result.missing].sort(), [
      'DATABASE_URL',
      'OPERATOR_API_KEY',
      'WEBHOOK_SECRET',
    ]);
  });
});

describe('blank variables count as missing', () => {
  for (const name of REQUIRED_ENV_VARS) {
    test(`rejects when ${name} is an empty string`, () => {
      const env = { ...VALID_ENV, [name]: '' } as unknown as NodeJS.ProcessEnv;
      const result = validateConfig(env);
      assert.equal(result.ok, false);
      assert.deepEqual(result.missing, [name]);
    });

    test(`rejects when ${name} is whitespace only`, () => {
      const env = { ...VALID_ENV, [name]: '   ' } as unknown as NodeJS.ProcessEnv;
      const result = validateConfig(env);
      assert.equal(result.ok, false);
      assert.deepEqual(result.missing, [name]);
    });
  }

  test('a tab/newline-only value is still treated as blank', () => {
    const env = { ...VALID_ENV, WEBHOOK_SECRET: '\t\n' } as unknown as NodeJS.ProcessEnv;
    assert.deepEqual(validateConfig(env).missing, ['WEBHOOK_SECRET']);
  });
});

describe('error message never leaks a secret value', () => {
  test('names the missing variable but contains no value', () => {
    const env = { ...VALID_ENV, OPERATOR_API_KEY: undefined } as unknown as NodeJS.ProcessEnv;
    const { error } = validateConfig(env);
    assert.ok(error);
    assert.match(error, /OPERATOR_API_KEY/);
  });

  test('a configured secret value never appears in the message', () => {
    // Two of three are set to distinctive values; the third is missing.
    // The resulting message must not echo the two that ARE configured.
    const env = {
      DATABASE_URL: 'postgresql://u:SUPERSECRETPASSWORD@host/db',
      WEBHOOK_SECRET: 'DISTINCTIVE-SECRET-VALUE',
      // OPERATOR_API_KEY intentionally absent
    } as unknown as NodeJS.ProcessEnv;
    const { error } = validateConfig(env);
    assert.ok(error);
    assert.doesNotMatch(error, /SUPERSECRETPASSWORD/);
    assert.doesNotMatch(error, /DISTINCTIVE-SECRET-VALUE/);
    assert.doesNotMatch(error, /postgresql:\/\//);
  });

  test('a blank value does not cause an empty-string artefact in the message', () => {
    const env = { ...VALID_ENV, WEBHOOK_SECRET: '' } as unknown as NodeJS.ProcessEnv;
    const { error } = validateConfig(env);
    assert.ok(error);
    assert.match(error, /WEBHOOK_SECRET/);
    assert.doesNotMatch(error, /=\s*$/);
  });

  test('does not dump the ambient process.env', () => {
    // Guards a real leak class the injected-env tests miss: a message
    // built from the AMBIENT process.env rather than the argument. A
    // sentinel is placed on the real process.env for the duration of
    // this test only.
    const SENTINEL = 'AMBIENT-ENV-SENTINEL-VALUE';
    const KEY = '__G02_LEAK_PROBE__';
    process.env[KEY] = SENTINEL;
    try {
      const { error } = validateConfig({} as NodeJS.ProcessEnv);
      assert.ok(error);
      assert.doesNotMatch(error, new RegExp(SENTINEL));
    } finally {
      delete process.env[KEY];
    }
  });

  test('the message tells the operator where to fix it', () => {
    assert.match(formatMissingEnvError(['WEBHOOK_SECRET']), /Render/);
  });

  test('pluralisation is correct for one vs many', () => {
    assert.match(formatMissingEnvError(['WEBHOOK_SECRET']), /variable not set/);
    assert.match(formatMissingEnvError(['WEBHOOK_SECRET', 'DATABASE_URL']), /variables not set/);
  });
});

describe('findMissingEnvVars returns names only', () => {
  test('every returned entry is a known variable name', () => {
    const missing = findMissingEnvVars({} as NodeJS.ProcessEnv);
    for (const name of missing) {
      assert.ok(
        (REQUIRED_ENV_VARS as readonly string[]).includes(name),
        `unexpected entry: ${name}`
      );
    }
  });
});
