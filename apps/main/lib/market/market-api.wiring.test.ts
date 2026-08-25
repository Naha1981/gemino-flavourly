import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..', '..', 'app', 'api', 'market');

const ROUTES = [
  'competitors/route.ts',
  'competitors/discover/route.ts',
  'competitors/[id]/menu-history/route.ts',
  'competitors/[id]/promotions/route.ts',
  'alerts/route.ts',
];

/** Route-segment config Next.js allows a route module to export. */
const ALLOWED_EXPORTS = new Set(['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'dynamic', 'runtime', 'maxDuration', 'revalidate']);

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function route(rel: string): string {
  const full = join(API_DIR, rel);
  assert.ok(existsSync(full), `missing expected route file: ${rel}`);
  return full;
}

function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

describe('market API: route inventory and Next.js route contract', () => {
  test('every documented market route exists', () => {
    for (const rel of ROUTES) route(rel);
  });

  test('route modules export only handlers and route-segment config', () => {
    // A stray helper export from app/api/**\/route.ts fails `next build`'s
    // route type check, so it is caught here instead of at deploy time.
    for (const rel of ROUTES) {
      const src = code(route(rel));
      const names = Array.from(src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_]+)/gm)).map(
        (match) => match[1]
      );
      assert.ok(names.length > 0, `${rel} exports no handler`);
      for (const name of names) {
        assert.ok(ALLOWED_EXPORTS.has(name), `${rel} exports "${name}", which Next.js does not allow in a route module`);
      }
    }
  });
});

describe('market API: authentication and tenant isolation', () => {
  test('every handler resolves the tenant and 401s before touching the store', () => {
    for (const rel of ROUTES) {
      const src = code(route(rel));
      assert.match(src, /getOrCreateTenant\(\)/, `${rel} does not resolve the tenant`);
      assert.match(src, /status:\s*401/, `${rel} has no 401 path`);

      const handler = from(src, 'export async function');
      const authAt = handler.indexOf('Unauthorized');
      const storeAt = handler.search(
        /\b(listCompetitors|createCompetitor|knownPlaceIds|listMenuSnapshots|listPromotions|recentMarketAlerts|saveTenantLocation|discoverCompetitors)\(/
      );
      assert.ok(authAt > -1, `${rel} has no Unauthorized guard`);
      assert.ok(storeAt === -1 || authAt < storeAt, `${rel} must authenticate before any store access`);
    }
  });

  test('every store call is passed the signed-in tenant id', () => {
    // Mutation guard: a store call that lost its tenant argument (or was
    // handed a body-supplied one) fails here.
    for (const rel of ROUTES) {
      const src = code(route(rel));
      const calls = Array.from(src.matchAll(/\b(listCompetitors|createCompetitor|knownPlaceIds|saveTenantLocation|listMenuSnapshots|listPromotions|recentMarketAlerts)\(\s*([^,)]+)/g));
      assert.ok(calls.length > 0, `${rel} calls no tenant-scoped store helper`);
      for (const call of calls) {
        assert.equal(
          call[2].trim(),
          'tenant.id',
          `${rel}: ${call[1]} must be scoped to tenant.id, got "${call[2].trim()}"`
        );
      }
      // Nobody may read a tenant id out of the request.
      assert.doesNotMatch(src, /body\.tenant_id/);
      assert.doesNotMatch(src, /searchParams\.get\(\s*['"]tenant/);
    }
  });
});

describe('market API: discovery endpoint', () => {
  const src = code(route('competitors/discover/route.ts'));

  test('requires an address, from the body or the tenant record', () => {
    assert.match(src, /requestedAddress \|\| tenant\.address/);
    assert.match(src, /status:\s*400/);
  });

  test('radius is clamped rather than passed straight to Google', () => {
    assert.match(src, /clampRadiusKm\(/);
    assert.match(src, /discoverCompetitors\(address,\s*\{\s*radiusKm/);
  });

  test('already-tracked places and the tenant own place are skipped', () => {
    assert.match(src, /knownPlaceIds\(tenant\.id\)/);
    assert.match(src, /if\s*\(known\.has\(restaurant\.googlePlaceId\)\)/);
    assert.match(src, /skippedExisting \+= 1/);
    assert.match(src, /known\.add\(restaurant\.googlePlaceId\)/, 'a single run must not add the same place twice');
  });

  test('one run cannot flood the competitor list', () => {
    assert.match(src, /MAX_ADDED_PER_RUN/);
    assert.match(src, /if\s*\(added\.length >= MAX_ADDED_PER_RUN\)\s*break/);
  });

  test('the geocoded origin is remembered on the tenant', () => {
    const handler = from(src, 'export async function POST');
    const saveAt = handler.indexOf('saveTenantLocation(');
    const createAt = handler.indexOf('createCompetitor(');
    assert.ok(saveAt > -1 && createAt > -1);
    assert.ok(saveAt < createAt, 'the origin is stored before the rows that reference it');
  });

  test('an ungeocodable address is a 422 and an API failure is a 502', () => {
    assert.match(src, /No coordinates found[\s\S]{0,80}422/);
    assert.match(src, /:\s*502/);
  });
});

describe('market API: list and manual add', () => {
  const src = code(route('competitors/route.ts'));

  test('the list joins snapshots and promotion counts in one pass each', () => {
    assert.match(src, /Promise\.all\(\[[\s\S]*listCompetitors\(tenant\.id\),[\s\S]*latestSnapshotsByCompetitor\(tenant\.id\),[\s\S]*promotionCountsByCompetitor\(tenant\.id\)/);
    assert.match(src, /last_menu_snapshot_at/);
    assert.match(src, /promotion_count/);
    assert.match(src, /tenant_location/);
  });

  test('manual add validates the name and the website scheme', () => {
    assert.match(src, /name\.length > 160/);
    assert.match(src, /new URL\(raw\)/);
    assert.match(src, /parsed\.protocol !== 'http:' && parsed\.protocol !== 'https:'/);
    assert.match(src, /status:\s*201/);
  });

  test('manual add does not require a Google place id', () => {
    assert.doesNotMatch(src, /place_id is required/);
  });
});

describe('market API: menu history, promotions and alerts', () => {
  test('menu history computes the diff between consecutive snapshots server-side', () => {
    const src = code(route('competitors/[id]/menu-history/route.ts'));
    assert.match(src, /listMenuSnapshots\(tenant\.id,\s*params\.id/);
    assert.match(src, /diffMenus\(itemsFromText\(previous\.menuText\),\s*items\)/);
    assert.match(src, /new_items|removed_items|price_changes/);
    assert.match(src, /changes:\s*diff/);
  });

  test('promotions are listed newest-first through the tenant-scoped store', () => {
    const src = code(route('competitors/[id]/promotions/route.ts'));
    assert.match(src, /listPromotions\(tenant\.id,\s*params\.id/);
    assert.match(src, /promotion_text/);
    assert.match(src, /detected_at/);
  });

  test('alerts default to 30 days and cap at 90', () => {
    const src = code(route('alerts/route.ts'));
    assert.match(src, /recentMarketAlerts\(tenant\.id,\s*days\)/);
    assert.match(src, /'30'/);
    assert.match(src, /Math\.min\(daysParam,\s*90\)/);
  });
});
