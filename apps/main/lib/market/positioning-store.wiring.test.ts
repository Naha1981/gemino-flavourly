import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pickTenantMenu } from './positioning-analyzer.ts';
import { buildPositioningReport } from './positioning-analyzer.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'positioning-store.ts');
const ANALYZER = join(HERE, 'positioning-analyzer.ts');
const ROUTE = join(HERE, '..', '..', 'app', 'api', 'market', 'positioning', 'route.ts');
const PAGE = join(HERE, '..', '..', 'app', 'dashboard', 'market', 'positioning', 'page.tsx');

const ALLOWED_EXPORTS = new Set(['GET', 'POST', 'PATCH', 'DELETE', 'dynamic', 'runtime', 'maxDuration', 'revalidate']);

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function body(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at).split('\nexport ')[0];
}

describe('positioning store: tenant isolation and data assembly', () => {
  const store = code(STORE);

  test('every query is scoped to the tenant', () => {
    assert.match(body(store, 'export async function tenantGoogleRating'), /eq\(googleReviews\.tenantId,\s*tenantId\)/);
    assert.match(body(store, 'export async function collectPositioningInput'), /eq\(tenants\.id,\s*tenantId\)/);
    const competitors = body(store, 'export async function collectPositioningCompetitors');
    assert.match(competitors, /listCompetitors\(tenantId\)/);
    assert.match(competitors, /latestSnapshotsByCompetitor\(tenantId\)/);
  });

  test('the tenant rating window is bounded, not "all history"', () => {
    const fnBody = body(store, 'export async function tenantGoogleRating');
    assert.match(fnBody, /gte\(googleReviews\.time,\s*since\)/);
    assert.match(fnBody, /Math\.max\(1,\s*days\)/);
  });

  test('an unrated tenant is reported as null, never as 0 stars', () => {
    const fnBody = body(store, 'export async function tenantGoogleRating');
    assert.match(fnBody, /total === 0/);
    assert.match(fnBody, /return \{ rating: null, reviewCount: null \}/);
  });

  test('competitor ratings of 0 read as "no rating"', () => {
    const fnBody = body(store, 'export async function collectPositioningCompetitors');
    assert.match(fnBody, /rating > 0 \? rating : null/);
    assert.match(fnBody, /row\.reviewCount > 0 \? row\.reviewCount : null/);
  });

  test('the tenant Google price level is left null rather than borrowed', () => {
    assert.match(body(store, 'export async function collectPositioningInput'), /priceLevel:\s*null/);
  });

  test('the report is built by the pure analyzer, in this store only', () => {
    assert.match(body(store, 'export async function getPositioningReport'), /buildPositioningReport\(input,\s*options\)/);
  });
});

describe('positioning store: menu source honesty', () => {
  test('menu_text wins, then description, then the AI prompt', () => {
    assert.deepEqual(
      pickTenantMenu({ menuText: 'Steak R280', description: 'A bistro', systemPrompt: 'Be friendly' }),
      { text: 'Steak R280', source: 'menu_text' }
    );
    assert.deepEqual(pickTenantMenu({ menuText: '  ', description: 'A bistro', systemPrompt: 'Be friendly' }), {
      text: 'A bistro',
      source: 'description',
    });
    assert.deepEqual(pickTenantMenu({ menuText: null, description: null, systemPrompt: 'Menu: Steak R280' }), {
      text: 'Menu: Steak R280',
      source: 'system_prompt',
    });
    assert.deepEqual(pickTenantMenu({ menuText: null, description: null, systemPrompt: null }), {
      text: null,
      source: 'none',
    });
  });

  test('the source reaches the report, so the UI can warn about a fallback', () => {
    const report = buildPositioningReport(
      {
        tenant: {
          name: 'X',
          menuItems: [],
          menuSource: 'description',
          googleRating: null,
          reviewCount: null,
          priceLevel: null,
        },
        competitors: [],
      },
      { now: new Date('2026-08-25T00:00:00.000Z') }
    );
    assert.equal(report.tenant.menu_source, 'description');
  });

  test('the analyzer imports neither the database nor a network client', () => {
    const analyzer = code(ANALYZER);
    assert.doesNotMatch(analyzer, /from\s+'@\/lib\/db'/);
    assert.doesNotMatch(analyzer, /from\s+'next\//);
    assert.doesNotMatch(analyzer, /\bfetch\(/);
  });
});

describe('positioning API wiring', () => {
  const route = code(ROUTE);

  test('the route exports only a handler and route config', () => {
    const names = Array.from(route.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_]+)/gm)).map(
      (match) => match[1]
    );
    assert.deepEqual(names.sort(), ['GET', 'dynamic'].sort());
    for (const name of names) assert.ok(ALLOWED_EXPORTS.has(name), `unexpected export: ${name}`);
  });

  test('it authenticates before building the report and passes tenant.id', () => {
    assert.match(route, /getOrCreateTenant\(\)/);
    assert.match(route, /status:\s*401/);
    const authAt = route.indexOf('Unauthorized');
    const reportAt = route.indexOf('getPositioningReport(');
    assert.ok(authAt > -1 && reportAt > -1);
    assert.ok(authAt < reportAt, 'the report must not be built for an anonymous caller');
    assert.match(route, /getPositioningReport\(tenant\.id/);
  });
});

describe('positioning dashboard wiring', () => {
  const page = code(PAGE);

  test('the page renders all four sections from the report', () => {
    assert.match(page, /getPositioningReport\(tenant\.id/);
    assert.match(page, /report\.price\.standings\.map/);
    assert.match(page, /report\.rating\.standings\.map/);
    assert.match(page, /report\.menu_overlap\.per_competitor\.map/);
    assert.match(page, /report\.unique_offerings\.items/);
    assert.match(page, /report\.headline/);
  });

  test('a fallback menu source is flagged to the owner, not hidden', () => {
    assert.match(page, /report\.tenant\.menu_source !== 'menu_text'/);
    assert.match(page, /Add your menu in Settings/);
    assert.match(page, /dashboard\/settings/);
  });

  test('the tenant row is highlighted in both the price chart and the ranking', () => {
    assert.match(page, /entry\.isTenant/);
  });

  test('bars degrade to zero width when a value is unknown', () => {
    assert.match(page, /entry\.average === null \? '0%'/);
    assert.match(page, /entry\.overlapPercent === null/);
  });
});
