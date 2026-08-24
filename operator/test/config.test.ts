import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_ENV_VARS,
  findMissingEnvVars,
  formatMissingEnvError,
  validateConfig,
  findWebhookTargetError,
  isProductionLike,
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


/**
 * G0.3: production must never forward inbound WhatsApp messages to
 * localhost. The default target is http://localhost:3000/..., and nothing
 * in the codebase populates wa_account_bindings, so that default is the
 * only path actually used — in production it silently discards every
 * inbound message while /health still reports 200.
 */

const PROD_BASE = {
  DATABASE_URL: 'postgresql://user:placeholder@localhost:5432/db',
  WEBHOOK_SECRET: 'placeholder-webhook-secret',
  OPERATOR_API_KEY: 'placeholder-operator-api-key',
  NODE_ENV: 'production',
} as unknown as NodeJS.ProcessEnv;

describe('isProductionLike', () => {
  test('true for NODE_ENV=production', () => {
    assert.equal(isProductionLike({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), true);
  });

  test('true on Render even when NODE_ENV is unset', () => {
    // Absence of NODE_ENV must not be read as "development".
    assert.equal(isProductionLike({ RENDER: 'true' } as unknown as NodeJS.ProcessEnv), true);
  });

  test('false for a bare local environment', () => {
    assert.equal(isProductionLike({} as NodeJS.ProcessEnv), false);
    assert.equal(isProductionLike({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), false);
  });
});

describe('webhook target: local development is unaffected', () => {
  test('localhost is allowed when not production-like', () => {
    const env = {
      MAIN_APP_WEBHOOK_URL: 'http://localhost:3000/api/webhooks/whatsapp',
    } as unknown as NodeJS.ProcessEnv;
    assert.equal(findWebhookTargetError(env), null);
  });

  test('an unset target is allowed locally (the default is correct there)', () => {
    assert.equal(findWebhookTargetError({} as NodeJS.ProcessEnv), null);
  });
});

describe('webhook target: production rejects unreachable targets', () => {
  for (const host of [
    'http://localhost:3000/api/webhooks/whatsapp',
    'http://127.0.0.1:3000/api/webhooks/whatsapp',
    'http://0.0.0.0:3000/api/webhooks/whatsapp',
    'http://[::1]:3000/api/webhooks/whatsapp',
    'http://app.localhost/api/webhooks/whatsapp',
  ]) {
    test(`rejects ${host}`, () => {
      const env = { ...PROD_BASE, MAIN_APP_WEBHOOK_URL: host } as NodeJS.ProcessEnv;
      const err = findWebhookTargetError(env);
      assert.ok(err, `expected rejection for ${host}`);
      assert.match(err, /not reachable|Refusing to start/);
    });
  }

  test('rejects an unset target in production', () => {
    const env = { ...PROD_BASE } as Record<string, string>;
    delete env.MAIN_APP_WEBHOOK_URL;
    const err = findWebhookTargetError(env as unknown as NodeJS.ProcessEnv);
    assert.ok(err);
    assert.match(err, /MAIN_APP_WEBHOOK_URL/);
  });

  test('rejects a blank target in production', () => {
    const env = { ...PROD_BASE, MAIN_APP_WEBHOOK_URL: '   ' } as NodeJS.ProcessEnv;
    assert.ok(findWebhookTargetError(env));
  });

  test('rejects a malformed URL', () => {
    const env = { ...PROD_BASE, MAIN_APP_WEBHOOK_URL: 'not-a-url' } as NodeJS.ProcessEnv;
    assert.ok(findWebhookTargetError(env));
  });

  test('rejects a non-http protocol', () => {
    const env = { ...PROD_BASE, MAIN_APP_WEBHOOK_URL: 'ftp://example.com/hook' } as NodeJS.ProcessEnv;
    assert.ok(findWebhookTargetError(env));
  });

  test('also applies on Render when NODE_ENV is unset', () => {
    const env = {
      DATABASE_URL: 'postgresql://u:p@h/db',
      WEBHOOK_SECRET: 's',
      OPERATOR_API_KEY: 'k',
      RENDER: 'true',
      MAIN_APP_WEBHOOK_URL: 'http://localhost:3000/api/webhooks/whatsapp',
    } as unknown as NodeJS.ProcessEnv;
    assert.ok(findWebhookTargetError(env));
  });

  test('accepts a real public https URL', () => {
    const env = {
      ...PROD_BASE,
      MAIN_APP_WEBHOOK_URL: 'https://app.example.com/api/webhooks/whatsapp',
    } as NodeJS.ProcessEnv;
    assert.equal(findWebhookTargetError(env), null);
  });

  test('the error never contains a secret value', () => {
    const env = {
      ...PROD_BASE,
      WEBHOOK_SECRET: 'DISTINCTIVE-SECRET-VALUE',
      MAIN_APP_WEBHOOK_URL: 'http://localhost:3000/api/webhooks/whatsapp',
    } as NodeJS.ProcessEnv;
    const err = findWebhookTargetError(env)!;
    assert.doesNotMatch(err, /DISTINCTIVE-SECRET-VALUE/);
  });
});

describe('validateConfig integrates the webhook target check', () => {
  test('a production config pointing at localhost fails validation', () => {
    const env = {
      ...PROD_BASE,
      MAIN_APP_WEBHOOK_URL: 'http://localhost:3000/api/webhooks/whatsapp',
    } as NodeJS.ProcessEnv;
    const r = validateConfig(env);
    assert.equal(r.ok, false);
    assert.match(r.error!, /MAIN_APP_WEBHOOK_URL|not reachable/);
  });

  test('a fully valid production config passes', () => {
    const env = {
      ...PROD_BASE,
      MAIN_APP_WEBHOOK_URL: 'https://app.example.com/api/webhooks/whatsapp',
    } as NodeJS.ProcessEnv;
    assert.equal(validateConfig(env).ok, true);
  });

  test('missing required variables are still reported first', () => {
    const env = { NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv;
    const r = validateConfig(env);
    assert.equal(r.ok, false);
    assert.ok(r.missing.length > 0);
  });
});
