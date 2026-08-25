import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'competitor-store.ts');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Comments stripped so prose about scoping cannot be mistaken for a filter. */
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

/** The body of one exported function (up to the next top-level export). */
function body(src: string, needle: string): string {
  return from(src, needle).split('\nexport ')[0];
}

const src = code(STORE);

describe('market competitor store: tenant isolation', () => {
  test('every tenant-facing read/write pins tenant_id', () => {
    // Reads/updates filter on tenant_id…
    for (const fn of [
      'export async function updateCompetitor',
      'export async function getCompetitor',
      'export async function listCompetitors',
      'export async function knownPlaceIds',
      'export async function recentMarketAlerts',
    ]) {
      const fnBody = body(src, fn);
      assert.match(fnBody, /eq\((competitors|messages)\.tenantId,\s*tenantId\)/, `${fn} is not tenant-scoped`);
    }
    // …an insert stamps it on the row instead…
    assert.match(body(src, 'export async function createCompetitor'), /values\(\{\s*tenantId,/);
    // …and the tenant's own row is addressed BY its id.
    assert.match(body(src, 'export async function saveTenantLocation'), /eq\(tenants\.id,\s*tenantId\)/);
  });

  test('child-table reads scope through the owning competitor row', () => {
    // A leaked competitor/snapshot uuid must not be enough to read another
    // tenant's menu history or promotions.
    for (const fn of ['export async function listMenuSnapshots', 'export async function listPromotions']) {
      const fnBody = body(src, fn);
      assert.match(fnBody, /getCompetitor\(tenantId,\s*competitorId\)/, `${fn} does not verify ownership`);
      assert.match(fnBody, /if\s*\(!owner\)\s*return\s*\[\]/, `${fn} must bail when the row is not the tenant's`);
    }
  });

  test('updateCompetitor cannot write across tenants and only patches given keys', () => {
    const fnBody = body(src, 'export async function updateCompetitor');
    assert.match(fnBody, /and\(eq\(competitors\.tenantId,\s*tenantId\),\s*eq\(competitors\.id,\s*competitorId\)\)/);
    assert.match(fnBody, /return row \?\? null/, 'a cross-tenant id must read as "not found", not success');
    // Every mutable field is guarded, so a partial update cannot blank the rest.
    for (const field of ['name', 'address', 'latitude', 'longitude', 'distanceKm', 'googlePlaceId', 'websiteUrl', 'phone']) {
      assert.match(fnBody, new RegExp(`if \\(data\\.${field} !== undefined\\)`), `${field} is not conditionally patched`);
    }
    assert.match(fnBody, /updatedAt:\s*new Date\(\)/);
  });

  test('the platform-wide helpers are the only unscoped competitor queries', () => {
    // Mutation guard: count every competitors query in the file and require
    // each one to be either tenant-scoped or in the documented cron/admin
    // allowlist. Dropping a filter from a tenant-facing helper fails here.
    const blocks = src.split('\nexport ').slice(1);
    // Platform-wide by design: the daily cron sweep and the Super Admin KPIs.
    const allowlist = new Set(['findTrackedCompetitors', 'countAllMarketCompetitors']);
    // Cron-only writes keyed by the row id it just read.
    const cronOnlyByKey = new Set(['saveDiscoveredMenuUrl']);

    for (const block of blocks) {
      const nameMatch = block.match(/(?:async function|const)\s+([A-Za-z0-9_]+)/);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      const touchesCompetitors = /\.from\(competitors\)|\.update\(competitors\)|\.insert\(competitors\)/.test(block);
      if (!touchesCompetitors) continue;

      // Scoped means either a where-filter on tenant_id or an insert that
      // stamps the parameter onto the new row.
      const scoped =
        /eq\(competitors\.tenantId,\s*tenantId\)/.test(block) || /values\(\{\s*tenantId,/.test(block);
      const allowed = allowlist.has(name);
      const keyScoped = cronOnlyByKey.has(name) && /eq\(competitors\.id,\s*competitorId\)/.test(block);
      assert.ok(
        scoped || allowed || keyScoped,
        `${name} queries competitors without a tenant filter and is not on the platform-wide allowlist`
      );
      if (allowed) {
        assert.ok(!scoped, `${name} is allowlisted as platform-wide but carries a tenant filter`);
      }
      if (cronOnlyByKey.has(name)) {
        assert.ok(keyScoped, `${name} must stay keyed on a single competitor id`);
      }
    }
  });

  test('saveDiscoveredMenuUrl is id-keyed and only called by the platform cron', () => {
    const fnBody = body(src, 'export async function saveDiscoveredMenuUrl');
    assert.match(fnBody, /update\(competitors\)/);
    assert.match(fnBody, /eq\(competitors\.id,\s*competitorId\)/);
    assert.match(fnBody, /websiteUrl/);
  });
});

describe('market competitor store: write shape', () => {
  test('snapshots and promotions are append-only inserts', () => {
    for (const fn of ['export async function saveMenuSnapshot', 'export async function savePromotion']) {
      const fnBody = body(src, fn);
      assert.match(fnBody, /\.insert\(/);
      assert.doesNotMatch(fnBody, /\.update\(/, `${fn} must not overwrite history`);
      assert.doesNotMatch(fnBody, /\.delete\(/, `${fn} must not delete history`);
    }
  });

  test('numeric columns are validated before they are written', () => {
    const fnBody = body(src, 'function numericOrNull');
    assert.match(fnBody, /Number\.isFinite\(parsed\)/);
    assert.match(fnBody, /return null/, 'a non-finite value becomes NULL, never 0');
  });

  test('text columns are trimmed and length-capped', () => {
    const fnBody = body(src, 'function cleanText');
    assert.match(fnBody, /\.trim\(\)/);
    assert.match(fnBody, /\.slice\(0,\s*max\)/);
    const snapshot = body(src, 'export async function saveMenuSnapshot');
    assert.match(snapshot, /cleanText\(menuText,\s*60_000\)/);
  });

  test('the competitor list sorts nearest-first with unknown distances last', () => {
    const fnBody = body(src, 'export async function listCompetitors');
    assert.match(fnBody, /CASE WHEN \$\{competitors\.distanceKm\} IS NULL THEN 1 ELSE 0 END/);
    assert.match(fnBody, /asc\(competitors\.distanceKm\)/);
  });

  test('the newest snapshot wins the diff baseline', () => {
    const fnBody = body(src, 'export async function getLatestMenuSnapshot');
    assert.match(fnBody, /desc\(competitorMenuSnapshots\.snapshotAt\)/);
    assert.match(fnBody, /limit\(1\)/);
  });

  test('the dedupe window is bounded and cannot go negative', () => {
    const fnBody = body(src, 'export async function getRecentPromotions');
    assert.match(fnBody, /Math\.max\(1,\s*days\)/);
    assert.match(fnBody, /gte\(competitorPromotions\.detectedAt,\s*since\)/);
  });
});

describe('market competitor store: alerts', () => {
  test('alerts reuse the reputation engine system inbox, never the outbox', () => {
    assert.match(src, /import\s*\{\s*insertSystemAlert,?\s*\}\s*from\s*'@\/lib\/reputation\/competitor-store'/);
    const fnBody = body(src, 'export async function insertMarketAlert');
    assert.match(fnBody, /insertSystemAlert\(tenantId,\s*text\)/);
    assert.doesNotMatch(src, /\bjobs\b/, 'a staff alert must never enqueue a WhatsApp dispatch');
  });

  test('alert reads are tenant-scoped and filtered by the market prefix', () => {
    const fnBody = body(src, 'export async function recentMarketAlerts');
    assert.match(fnBody, /eq\(messages\.tenantId,\s*tenantId\)/);
    assert.match(fnBody, /eq\(messages\.direction,\s*'system'\)/);
    assert.match(fnBody, /like\(messages\.content,\s*`\$\{MARKET_ALERT_PREFIX\}%`\)/);
    assert.match(fnBody, /gte\(messages\.createdAt,\s*since\)/);
  });

  test('the weekly platform metric counts the same prefix, unscoped by design', () => {
    const fnBody = body(src, 'export async function countMarketAlertsThisWeek');
    assert.match(fnBody, /like\(messages\.content,\s*`\$\{MARKET_ALERT_PREFIX\}%`\)/);
    assert.doesNotMatch(fnBody, /tenantId/);
  });
});

describe('market competitor store: discovery helpers', () => {
  test('discovery skips already-tracked places and the tenant own place', () => {
    const fnBody = body(src, 'export async function knownPlaceIds');
    assert.match(fnBody, /from\(competitors\)/);
    assert.match(fnBody, /from\(googlePlacesConfig\)/);
    assert.match(fnBody, /eq\(googlePlacesConfig\.tenantId,\s*tenantId\)/);
    assert.match(fnBody, /new Set<string>\(\)/);
  });

  test('the tracking adapter wires the runner to the real helpers', () => {
    const adapter = body(src, 'export const drizzleMarketTrackingStore');
    assert.match(adapter, /findTrackedCompetitors/);
    assert.match(adapter, /getLatestMenuSnapshot/);
    assert.match(adapter, /saveMenuSnapshot/);
    assert.match(adapter, /getRecentPromotions/);
    assert.match(adapter, /savePromotion/);
    assert.match(adapter, /createAlert:\s*insertMarketAlert/);
    assert.match(adapter, /saveDiscoveredMenuUrl/);
  });
});
