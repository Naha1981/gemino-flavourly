import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

const DETECT_EVENTS_CRON = join(HERE, '..', '..', 'app', 'api', 'cron', 'detect-events', 'route.ts');

describe('detect-events cron wiring', () => {
  const route = code(DETECT_EVENTS_CRON);

  test('route is guarded before any store access', () => {
    assert.match(route, /import\s*\{[^}]*assertCronAuthorized[^}]*\}\s*from\s*'@\/lib\/cron\/auth'/);
    assert.match(route, /assertCronAuthorized\(req\)/);
    assert.match(route, /if\s*\(authError\)\s*return\s+authError;/);

    const handler = from(route, 'export async function GET');
    const guardAt = handler.indexOf('assertCronAuthorized(req)');
    const dbAt = handler.search(/\bdb\s*\./);
    assert.ok(guardAt > -1, 'guard call not found');
    if (dbAt > -1) assert.ok(guardAt < dbAt, 'database is accessed before the authorization check');
  });

  test('route honours the platform kill-switch before scanning tenants', () => {
    assert.match(route, /masterAiSwitch === false/);
    const handler = from(route, 'export async function GET');
    const switchAt = handler.indexOf('masterAiSwitch === false');
    const detectAt = handler.indexOf('detectEventOpportunities(');
    assert.ok(switchAt > -1 && detectAt > -1);
    assert.ok(switchAt < detectAt, 'the kill-switch must be checked before the detector runs');
  });

  test('route does not read a secret from the query string', () => {
    assert.doesNotMatch(
      code(DETECT_EVENTS_CRON),
      /searchParams\.get\(\s*['"](key|secret|token|cron_secret)['"]\s*\)/i
    );
  });

  test('the detector is invoked per tenant with the tenant id', () => {
    assert.match(route, /detectEventOpportunities\(tenant\.id\)/);
  });

  test('opportunities are persisted via the store', () => {
    assert.match(route, /saveOpportunities\(tenant\.id,\s*opportunities/);
  });
});
