import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');

function src(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return src(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

function from(srcStr: string, needle: string): string {
  const at = srcStr.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return srcStr.slice(at);
}

const ONBOARDING_API = join(APP, 'api', 'onboarding', 'route.ts');
const CONSENT_API = join(APP, 'api', 'consent', 'route.ts');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0016_billing_onboarding_consent.sql');

describe('onboarding schema', () => {
  test('tenants.onboarding_complete column exists', () => {
    const s = code(SCHEMA);
    assert.match(s, /onboardingComplete:\s*boolean\('onboarding_complete'\)\.default\(false\)\.notNull\(\)/);
  });

  test('consent_records table exists with required columns', () => {
    const s = code(SCHEMA);
    assert.match(s, /export const consentRecords = pgTable\(/);
    assert.match(s, /consentVersion:\s*text\('consent_version'\)\.notNull\(\)/);
    assert.match(s, /consentedAt:\s*timestamp\('consented_at'\)/);
  });

  test('migration 0016 creates consent_records and adds onboarding_complete', () => {
    const s = src(MIGRATION);
    assert.match(s, /onboarding_complete boolean DEFAULT false NOT NULL/);
    assert.match(s, /CREATE TABLE IF NOT EXISTS consent_records/);
    assert.match(s, /consent_records_tenant_idx/);
  });
});

describe('onboarding API', () => {
  test('POST saves profile and can mark complete', () => {
    const s = code(ONBOARDING_API);
    const body = from(s, 'export async function POST');
    assert.match(body, /complete === true/);
    assert.match(body, /onboardingComplete = true/);
    assert.match(body, /openingHours/);
  });
});

describe('consent API', () => {
  test('POST inserts a consent record tenant-scoped', () => {
    const s = code(CONSENT_API);
    const body = from(s, 'export async function POST');
    assert.match(body, /insert\(consentRecords\)/);
    assert.match(body, /tenantId:\s*tenant\.id/);
    assert.match(body, /consentVersion/);
    assert.match(body, /ipAddress/);
  });
});
