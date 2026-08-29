import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'opportunity-store.ts');
const API_DIR = join(HERE, '..', '..', 'app', 'api', 'market', 'opportunities');
const PAGE = join(HERE, '..', '..', 'app', '(app)', 'dashboard', 'market', 'opportunities', 'page.tsx');
const ANALYZER = join(HERE, 'opportunity-analyzer.ts');
const PAGE_ACTIONS = join(HERE, '..', '..', 'app', '(app)', 'dashboard', 'market', 'opportunities', 'opportunity-actions.tsx');

const ROUTES = ['route.ts', 'analyze/route.ts', '[id]/route.ts'];
const ALLOWED_EXPORTS = new Set(['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'dynamic', 'runtime', 'maxDuration', 'revalidate']);

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

function routeFile(rel: string): string {
  const full = join(API_DIR, rel);
  assert.ok(existsSync(full), `missing expected route file: ${rel}`);
  return full;
}

const store = code(STORE);

describe('opportunity store: tenant isolation', () => {
  test('every tenant-facing helper filters on tenant_id', () => {
    for (const fn of ['export async function getOpportunities', 'export async function collectCompetitorOfferings']) {
      assert.match(body(store, fn), /eq\((marketOpportunities|competitors)\.tenantId,\s*tenantId\)|listCompetitors\(tenantId\)/, `${fn} is not tenant-scoped`);
    }
    // listCompetitors / latestSnapshotsByCompetitor are themselves tenant-scoped
    // (proven in competitor-store.wiring.test.ts); this asserts the argument.
    const collect = body(store, 'export async function collectCompetitorOfferings');
    assert.match(collect, /listCompetitors\(tenantId\)/);
    assert.match(collect, /latestSnapshotsByCompetitor\(tenantId\)/);
  });

  test('markAddressed is tenant-scoped and reports success honestly', () => {
    const fnBody = body(store, 'export async function markAddressed');
    assert.match(fnBody, /and\(eq\(marketOpportunities\.tenantId,\s*tenantId\),\s*eq\(marketOpportunities\.id,\s*opportunityId\)\)/);
    assert.match(fnBody, /return Boolean\(row\)/, 'a cross-tenant id must read as "not found"');
  });

  test('saveOpportunities stamps the tenant and upserts on (tenant, key)', () => {
    const fnBody = body(store, 'export async function saveOpportunities');
    assert.match(fnBody, /insert\(marketOpportunities\)/);
    assert.match(fnBody, /tenantId,/);
    assert.match(fnBody, /onConflictDoUpdate/);
    assert.match(fnBody, /target:\s*\[marketOpportunities\.tenantId,\s*marketOpportunities\.key\]/);
  });

  test('a re-run never clears the addressed flag', () => {
    // Mutation guard: the upsert's `set` must not mention addressed, or an
    // owner who acted on a gap would watch it come back every morning.
    const fnBody = body(store, 'export async function saveOpportunities');
    const setBlock = fnBody.slice(fnBody.indexOf('set: {'));
    assert.doesNotMatch(setBlock, /addressed:/);
    assert.doesNotMatch(setBlock, /addressedAt:/);
  });

  test('the platform-wide refresh still goes through the per-tenant path', () => {
    const fnBody = body(store, 'export async function refreshOpportunitiesForTrackedTenants');
    assert.match(fnBody, /selectDistinctOn\(\[competitors\.tenantId\]/);
    // Ordered, because an unordered DISTINCT ON + LIMIT picks an arbitrary
    // subset each run and can starve the same tenants indefinitely.
    assert.match(fnBody, /orderBy\(competitors\.tenantId\)/);
    assert.match(fnBody, /refreshOpportunities\(row\.tenantId\)/, 'it must reuse the tenant-scoped analysis');
    assert.match(fnBody, /result\.failed \+= 1/, 'one tenant failing must not stop the sweep');
  });

  test('countAllOpportunities is the only unscoped read (Super Admin KPI)', () => {
    const blocks = store.split('\nexport ').slice(1);
    for (const block of blocks) {
      const name = block.match(/(?:async function|const)\s+([A-Za-z0-9_]+)/)?.[1];
      if (!name || !/\.from\(marketOpportunities\)|\.update\(marketOpportunities\)|\.insert\(marketOpportunities\)/.test(block)) continue;
      const scoped = /tenantId/.test(block);
      assert.ok(scoped || name === 'countAllOpportunities', `${name} touches market_opportunities without a tenant`);
    }
  });
});

describe('opportunity store: analyzer input', () => {
  test('competitor offerings carry Google types, serves flags and the newest snapshot', () => {
    const fnBody = body(store, 'export async function collectCompetitorOfferings');
    assert.match(fnBody, /itemsFromText\(snapshot\?\.menuText/);
    assert.match(fnBody, /priceRangeFromString\(snapshot\?\.priceRange/);
    assert.match(fnBody, /place\.types/);
    assert.match(fnBody, /place\.serves/);
    assert.match(fnBody, /distanceKm/);
  });

  test('the tenant offering reads the owner-editable columns and says so when empty', () => {
    const fnBody = body(store, 'export async function collectTenantOffering');
    assert.match(fnBody, /eq\(tenants\.id,\s*tenantId\)/);
    assert.match(fnBody, /menuText: tenants\.menuText/);
    assert.match(fnBody, /openingHours: tenants\.openingHours/);
    // No Google place types are stored for the tenant, so the analyzer gets an
    // empty list rather than an invented one.
    assert.match(fnBody, /placeTypes:\s*\[\]/);
  });

  test('refreshOpportunities runs the pure analyzer and persists the result', () => {
    // Exact needle: 'refreshOpportunities' alone would also match the
    // platform-wide refreshOpportunitiesForTrackedTenants below it.
    const fnBody = body(store, 'export async function refreshOpportunities(');
    assert.match(fnBody, /collectCompetitorOfferings\(tenantId\)/);
    assert.match(fnBody, /collectTenantOffering\(tenantId\)/);
    assert.match(fnBody, /analyzeOpportunities\(/);
    assert.match(fnBody, /saveOpportunities\(tenantId,\s*opportunities\)/);
  });

  test('the analyzer stays pure: no database or network imports', () => {
    const analyzer = code(ANALYZER);
    assert.doesNotMatch(analyzer, /from\s+'@\/lib\/db'/);
    assert.doesNotMatch(analyzer, /from\s+'next\//);
    assert.doesNotMatch(analyzer, /\bfetch\(/);
  });
});

describe('opportunity API wiring', () => {
  test('routes exist and export only handlers / route config', () => {
    for (const rel of ROUTES) {
      const src = code(routeFile(rel));
      const names = Array.from(
        src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_]+)/gm)
      ).map((match) => match[1]);
      assert.ok(names.length > 0, `${rel} exports no handler`);
      for (const name of names) {
        assert.ok(ALLOWED_EXPORTS.has(name), `${rel} exports "${name}", which Next.js does not allow in a route module`);
      }
    }
  });

  test('every handler authenticates before the store and passes tenant.id', () => {
    for (const rel of ROUTES) {
      const src = code(routeFile(rel));
      assert.match(src, /getOrCreateTenant\(\)/);
      assert.match(src, /status:\s*401/);

      const handlerAt = src.indexOf('export async function');
      const authAt = src.indexOf('Unauthorized', handlerAt);
      const storeAt = src.search(/\b(getOpportunities|refreshOpportunities|markAddressed)\(/);
      assert.ok(authAt > -1, `${rel} has no Unauthorized guard`);
      assert.ok(storeAt === -1 || authAt < storeAt, `${rel} must auth first`);

      const calls = Array.from(src.matchAll(/\b(getOpportunities|refreshOpportunities|markAddressed)\(\s*([^,)]+)/g));
      for (const call of calls) {
        assert.equal(call[2].trim(), 'tenant.id', `${rel}: ${call[1]} must be scoped to tenant.id`);
      }
    }
  });

  test('PATCH 404s on a foreign or missing opportunity', () => {
    const src = code(routeFile('[id]/route.ts'));
    assert.match(src, /status:\s*404/);
    assert.match(src, /Opportunity not found/);
  });

  test('PATCH with no body means "mark as addressed"', () => {
    const src = code(routeFile('[id]/route.ts'));
    assert.match(src, /body\.addressed === undefined \? true : Boolean\(body\.addressed\)/);
  });

  test('the analyze endpoint issues no outbound HTTP itself', () => {
    const src = code(routeFile('analyze/route.ts'));
    assert.doesNotMatch(src, /\bfetch\(/);
    assert.match(src, /refreshOpportunities\(tenant\.id\)/);
  });
});

describe('opportunities dashboard wiring', () => {
  test('the page lists gaps with score, evidence and the addressed control', () => {
    const src = code(PAGE);
    assert.match(src, /getOpportunities\(tenant\.id\)/);
    assert.match(src, /listCompetitors\(tenant\.id\)/);
    assert.match(src, /MarkAddressedButton/);
    assert.match(src, /AnalyzeMarketButton/);
    assert.match(src, /confidence\.toFixed\(2\)/);
    assert.match(src, /evidence\.map/);
  });

  test('the page explains the empty state instead of showing a blank list', () => {
    const src = code(PAGE);
    assert.match(src, /No competitors tracked yet/);
    assert.match(src, /No opportunities detected yet/);
  });

  test('the controls hit the tenant-scoped endpoints', () => {
    const src = code(PAGE_ACTIONS);
    assert.match(src, /\/api\/market\/opportunities\/analyze/);
    assert.match(src, /method:\s*'PATCH'/);
    assert.match(src, /addressed:\s*!addressed/);
  });
});
