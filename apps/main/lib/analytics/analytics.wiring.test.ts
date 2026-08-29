import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const LIB = join(HERE, '..');
const ENGINE = join(LIB, 'analytics', 'engine.ts');
const STORE = join(LIB, 'analytics', 'store.ts');
const ANALYTICS_DIR = join(APP, 'api', 'analytics');

const ROUTES = ['overview', 'revenue', 'customers', 'reputation', 'market', 'marketing', 'forecast'];

function src(path: string): string {
  return readFileSync(path, 'utf8');
}
function code(path: string): string {
  return src(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

describe('analytics engine wiring', () => {
  test('engine exposes the framework-free statistics', () => {
    const e = code(ENGINE);
    for (const fn of [
      'export function comparePeriods',
      'export function movingAverage',
      'export function linearRegression',
      'export function forecastRevenue',
      'export function cohortRetention',
      'export function summarizeDailySeries',
      'export function buildOverview',
    ]) {
      assert.match(e, new RegExp(fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
});

describe('analytics store wiring', () => {
  test('every series fetch is tenant-scoped', () => {
    const s = code(STORE);
    const fns = [
      'fetchRevenueSeries',
      'fetchOperationsSeries',
      'fetchReputationSeries',
      'fetchMarketSeries',
      'fetchMarketingSeries',
      'fetchCustomerCohorts',
    ];
    for (const fn of fns) {
      const body = s.slice(s.indexOf(`export async function ${fn}`));
      assert.match(body, /eq\([^)]*tenantId\)/, `${fn} is not tenant-scoped`);
    }
  });
});

describe('analytics API routes wiring', () => {
  for (const route of ROUTES) {
    const file = join(ANALYTICS_DIR, route, 'route.ts');
    test(`${route} is a tenant-guarded, force-dynamic route`, () => {
      const r = code(file);
      assert.match(r, /export const dynamic = 'force-dynamic'/);
      assert.match(r, /getOrCreateTenant\(\)/);
      assert.match(r, /401/);
    });
  }

  test('all seven analytics endpoints exist', () => {
    for (const route of ROUTES) {
      assert.ok(readFileSync(join(ANALYTICS_DIR, route, 'route.ts'), 'utf8').length > 0, `${route} route missing`);
    }
  });
});

describe('super admin analytics wiring', () => {
  test('admin analytics page is behind the super-admin gate', () => {
    const page = code(join(APP, '(app)', 'admin', 'analytics', 'page.tsx'));
    assert.match(page, /isSuperAdmin\(\)/);
    assert.match(page, /redirect\('\/sign-in'\)/);
    assert.match(page, /fetchPlatformAnalytics/);
  });
});
