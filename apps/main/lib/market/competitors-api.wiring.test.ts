import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..', '..', 'app', 'api', 'market');
const CRON = join(HERE, '..', '..', 'app', 'api', 'cron', 'track-competitors', 'route.ts');
const STORE = join(HERE, 'competitor-store.ts');

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

const ROUTES = [
  'competitors/route.ts',
  'competitors/discover/route.ts',
  'competitors/[id]/menu-history/route.ts',
  'competitors/[id]/promotions/route.ts',
  'alerts/route.ts',
];

describe('market competitors API wiring (Gates #15-#16)', () => {
  test('all five routes exist', () => {
    for (const rel of ROUTES) requireFile(rel);
  });

  test('every handler authenticates before touching the store and 401s', () => {
    for (const rel of ROUTES) {
      const src = code(requireFile(rel));
      assert.match(src, /getOrCreateTenant\(\)/, `${rel} does not resolve the tenant`);
      const handler = from(src, 'export async function');
      const authAt = handler.indexOf('Unauthorized');
      const storeAt = handler.search(/listCompetitors|upsertCompetitor|runDiscovery|getMenuHistory|listPromotionsForCompetitor|recentMarketAlerts|getCompetitor/);
      assert.ok(authAt > -1, `${rel} has no Unauthorized guard`);
      assert.ok(storeAt === -1 || authAt < storeAt, `${rel} must auth first`);
      assert.match(src, /status:\s*401/);
    }
  });

  test('detail routes pin BOTH tenant and competitor id', () => {
    for (const rel of ['competitors/[id]/menu-history/route.ts', 'competitors/[id]/promotions/route.ts']) {
      assert.match(code(requireFile(rel)), /getCompetitor\(tenant\.id,\s*params\.id\)/, `${rel} not tenant-scoped`);
    }
  });

  test('manual add validates name/website shape', () => {
    const src = code(requireFile('competitors/route.ts'));
    assert.match(src, /name is required/);
    assert.match(src, /website must be a http\(s\) URL/);
    assert.match(src, /test\(website\)/);
  });

  test('discover returns actionable errors for missing key/origin (not 500s)', () => {
    const src = code(requireFile('competitors/discover/route.ts'));
    assert.match(src, /503/);
    assert.match(src, /status:\s*400/);
    assert.match(src, /runDiscovery\(discoveryStore/);
  });
});

describe('market competitor store isolation checks', () => {
  const src = code(STORE);

  test('reads and mutations are tenant-scoped', () => {
    for (const fn of [
      'export async function updateCompetitor',
      'export async function listCompetitors',
      'export async function getSelfCompetitor',
      'export async function getCompetitor',
    ]) {
      assert.match(from(src, fn), /eq\(competitors\.tenantId,\s*tenantId\)/, `${fn} is not tenant-scoped`);
    }
    // History/promotion listings gate through getCompetitor (tenant+row).
    for (const fn of ['export async function getMenuHistory', 'export async function listPromotionsForCompetitor']) {
      assert.match(from(src, fn), /getCompetitor\(tenantId,\s*competitorId\)/, `${fn} does not gate on tenant`);
    }
    // Alert reads query the message stream, so their scope is messages.
    assert.match(from(src, 'export async function recentMarketAlerts'), /eq\(messages\.tenantId,\s*tenantId\)/);
  });

  test('upsert keys on the unique (tenant, place) pair', () => {
    const body = from(src, 'export async function upsertCompetitor');
    assert.match(body, /eq\(competitors\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(competitors\.googlePlaceId,\s*input\.googlePlaceId\)/);
    assert.match(body, /23505/); // race-safe fallback
  });

  test('the cron listing is platform-wide by design (documented seam)', () => {
    const body = from(src, 'export async function findCompetitorsWithWebsites').split('\n\nexport ')[0];
    assert.doesNotMatch(body, /tenantId/);
  });

  test('snapshot and promotion writes carry competitor_id cascades via FK', () => {
    assert.match(from(src, 'export async function saveMenuSnapshot'), /insert\(competitorMenuSnapshots\)/);
    assert.match(from(src, 'export async function savePromotion'), /insert\(competitorPromotions\)/);
  });
});

describe('tracking cron wiring (Gate #16)', () => {
  const src = code(CRON);

  test('route is guarded, kill-switch honoured, runner wired', () => {
    assert.match(src, /assertCronAuthorized\(req\)/);
    assert.match(src, /masterAiSwitch === false/);
    assert.match(src, /runCompetitorTrackingCron\(cronStore/);
  });

  test('alerts go through the inbox system-message channel, never the outbox', () => {
    assert.match(src, /createAlert:\s*insertSystemAlert/);
    assert.doesNotMatch(src, /insert\(jobs\)/);
  });
});
