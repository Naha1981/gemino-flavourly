import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..', '..', 'app', 'api', 'reputation', 'competitors');
const ADMIN = join(HERE, '..', '..', 'app', 'admin', 'page.tsx');
const PAGE = join(HERE, '..', '..', 'app', 'dashboard', 'reputation', 'competitors', 'page.tsx');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function requireFile(rel: string): string {
  const full = join(API_DIR, rel);
  assert.ok(existsSync(full), `missing expected route file: ${rel}`);
  return full;
}

function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

describe('competitors API wiring (Gate #14)', () => {
  test('list/add/delete/history routes exist', () => {
    for (const rel of ['route.ts', '[id]/route.ts', '[id]/history/route.ts']) requireFile(rel);
  });

  test('every handler authenticates before touching the store and 401s', () => {
    for (const rel of ['route.ts', '[id]/route.ts', '[id]/history/route.ts']) {
      const src = code(requireFile(rel));
      assert.match(src, /getOrCreateTenant\(\)/, `${rel} does not resolve the tenant`);
      // Scope to handler bodies: the store names naturally appear in the
      // import block, which sits above every handler.
      const handler = from(src, 'export async function');
      const authAt = handler.indexOf('Unauthorized');
      const storeAt = handler.search(/listCompetitors|createCompetitor|deleteCompetitor|getRatingHistory/);
      assert.ok(authAt > -1, `${rel} has no Unauthorized guard`);
      assert.ok(storeAt === -1 || authAt < storeAt, `${rel} must auth first`);
      assert.match(src, /status:\s*401/);
    }
  });

  test('add validates name + place_id shapes', () => {
    const src = code(requireFile('route.ts'));
    assert.match(src, /name\.length > 120/);
    assert.match(src, /placeId\.length < 6/);
  });

  test('delete is tenant-scoped and 404s on foreign ids', () => {
    const src = code(requireFile('[id]/route.ts'));
    assert.match(src, /deleteCompetitor\(tenant\.id,\s*params\.id\)/);
    assert.match(src, /status:\s*404/);
  });
});

describe('competitors dashboard + super admin wiring (Gate #14)', () => {
  test('dashboard page shows the weekly alerts banner, trend badges, add form, history', () => {
    const src = code(PAGE);
    assert.match(src, /recentCompetitorAlerts\(tenant\.id,\s*7\)/);
    assert.match(src, /rating drop/);
    assert.match(src, /AddCompetitorForm/);
    assert.match(src, /DeleteCompetitorButton/);
    assert.match(src, /competitorTrend/);
    assert.match(src, /getRatingHistory/);
  });

  test('super admin gains Competitors Monitored + Rating Drop Alerts KPIs', () => {
    const src = code(ADMIN);
    assert.match(src, /countAllCompetitors\(\)\.catch\(\(\) => 0\)/);
    assert.match(src, /countRatingDropAlertsThisWeek\(\)\.catch\(\(\) => 0\)/);
    assert.match(src, /Competitors Monitored/);
    assert.match(src, /Rating Drop Alerts/);
  });
});
