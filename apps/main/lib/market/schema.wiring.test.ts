import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIZZLE = join(HERE, '..', '..', 'drizzle');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const MIGRATION = join(DRIZZLE, '0012_competitors.sql');
const JOURNAL = join(DRIZZLE, 'meta', '_journal.json');
const MIGRATE_ROUTE = join(HERE, '..', '..', 'app', 'api', 'migrate', 'route.ts');

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

describe('Market Intelligence schema wiring (Gates #15-#17)', () => {
  test('competitors gains the discovery + tracking columns', () => {
    const table = from(code(SCHEMA), 'export const competitors = pgTable(');
    for (const col of ['address', 'latitude', 'longitude', 'distance_km', 'website_url', 'phone']) {
      assert.match(table, new RegExp(`'${col}'`), `competitors is missing ${col}`);
    }
    assert.match(table, /timestamp\('updated_at'\)\.defaultNow\(\)\.notNull\(\)/);
    assert.match(table, /boolean\('is_self'\)\.default\(false\)/);
  });

  test('competitors carries the distance index and unique (tenant, place)', () => {
    const table = from(code(SCHEMA), 'export const competitors = pgTable(');
    assert.match(table, /index\('competitors_distance_idx'\)\.on\(table\.distanceKm\)/);
    assert.match(table, /uniqueIndex\('competitors_tenant_place_uniq'\)/);
  });

  test('menu snapshots table matches the gate contract', () => {
    const table = from(code(SCHEMA), 'export const competitorMenuSnapshots = pgTable(');
    assert.match(table, /references\(\(\) => competitors\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(table, /text\('menu_url'\)/);
    assert.match(table, /text\('menu_text'\)/);
    assert.match(table, /text\('price_range'\)/);
    assert.match(table, /timestamp\('snapshot_at'\)\.defaultNow\(\)/);
    assert.match(table, /index\('competitor_menu_snapshots_competitor_idx'\)/);
  });

  test('promotions table matches the gate contract (+ dedup key)', () => {
    const table = from(code(SCHEMA), 'export const competitorPromotions = pgTable(');
    assert.match(table, /text\('promotion_text'\)\.notNull\(\)/);
    assert.match(table, /text\('source'\)/);
    assert.match(table, /timestamp\('detected_at'\)\.defaultNow\(\)/);
    assert.match(table, /text\('promotion_key'\)\.notNull\(\)/);
    assert.match(table, /index\('competitor_promotions_competitor_idx'\)/);
  });

  test('market opportunities table upserts by (tenant, key)', () => {
    const table = from(code(SCHEMA), 'export const marketOpportunities = pgTable(');
    assert.match(table, /uuid\('tenant_id'\)/);
    assert.match(table, /text\('opportunity_key'\)\.notNull\(\)/);
    assert.match(table, /text\('description'\)\.notNull\(\)/);
    assert.match(table, /numeric\('confidence'\)/);
    assert.match(table, /boolean\('addressed'\)\.default\(false\)/);
    assert.match(table, /uniqueIndex\('market_opportunities_tenant_key_uniq'\)/);
  });

  test('0012 migration mirrors all DDL', () => {
    const src = source(MIGRATION);
    for (const needle of [
      'ADD COLUMN IF NOT EXISTS "address"',
      'ADD COLUMN IF NOT EXISTS "distance_km"',
      'ADD COLUMN IF NOT EXISTS "website_url"',
      'competitors_distance_idx',
      'competitors_tenant_place_uniq',
      'CREATE TABLE IF NOT EXISTS "competitor_menu_snapshots"',
      'CREATE TABLE IF NOT EXISTS "competitor_promotions"',
      'CREATE TABLE IF NOT EXISTS "market_opportunities"',
      'competitor_menu_snapshots_competitor_idx',
      'competitor_promotions_competitor_idx',
      'market_opportunities_tenant_key_uniq',
    ]) {
      assert.ok(src.includes(needle), `0012 migration missing: ${needle}`);
    }
  });

  test('journal + /api/migrate carry the 0012 DDL', () => {
    const journal = JSON.parse(source(JOURNAL));
    assert.ok(journal.entries.some((e: { tag: string }) => e.tag === '0012_competitors'));
    const route = code(MIGRATE_ROUTE);
    assert.match(route, /ADD COLUMN IF NOT EXISTS distance_km/);
    assert.match(route, /CREATE TABLE IF NOT EXISTS competitor_menu_snapshots/);
    assert.match(route, /CREATE TABLE IF NOT EXISTS competitor_promotions/);
    assert.match(route, /CREATE TABLE IF NOT EXISTS market_opportunities/);
    assert.match(route, /competitors_tenant_place_uniq/);
  });
});
