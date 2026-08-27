import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIZZLE = join(HERE, '..', '..', 'drizzle');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const MIGRATION_0012 = join(DRIZZLE, '0012_competitors.sql');
const JOURNAL = join(DRIZZLE, 'meta', '_journal.json');
// The /api/migrate DDL was lifted verbatim out of the route handler into
// lib/db/migrate-ddl.ts so it can be EXECUTED by lib/db/migrate-execute.test.ts.
// These assertions check the same statements, now at their real home.
const MIGRATE_DDL_FILE = join(HERE, '..', 'db', 'migrate-ddl.ts');

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

/**
 * Strip SQL comments. The migration's prose deliberately explains the one
 * non-additive statement by NAME ("the DROP NOT NULL on google_place_id"), and
 * a guard that reads prose as DDL would either false-positive or have to be
 * weakened into meaninglessness.
 */
function sql(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

/** Just one exported pgTable block (up to the next top-level export). */
function table(src: string, needle: string): string {
  return from(src, needle).split('\nexport ')[0];
}

describe('Market Intelligence schema wiring (Gates #15-#18)', () => {
  const schema = code(SCHEMA);

  test('competitors gains the discovery columns and stays tenant-owned', () => {
    const competitors = table(schema, 'export const competitors = pgTable(');
    assert.match(competitors, /references\(\(\) => tenants\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(competitors, /address:\s*text\('address'\)/);
    assert.match(competitors, /latitude:\s*numeric\('latitude'\)/);
    assert.match(competitors, /longitude:\s*numeric\('longitude'\)/);
    assert.match(competitors, /distanceKm:\s*numeric\('distance_km'\)/);
    assert.match(competitors, /websiteUrl:\s*text\('website_url'\)/);
    assert.match(competitors, /phone:\s*text\('phone'\)/);
    assert.match(competitors, /placeData:\s*jsonb\('place_data'\)\.default\(\{\}\)\.notNull\(\)/);
    assert.match(competitors, /updatedAt:\s*timestamp\('updated_at'\)\.defaultNow\(\)\.notNull\(\)/);
    assert.match(competitors, /index\('competitors_tenant_idx'\)\.on\(table\.tenantId\)/);
    assert.match(competitors, /index\('competitors_distance_idx'\)\.on\(table\.distanceKm\)/);
  });

  test('google_place_id is nullable so a hand-added competitor is insertable', () => {
    const competitors = table(schema, 'export const competitors = pgTable(');
    assert.match(competitors, /googlePlaceId:\s*text\('google_place_id'\),/);
    assert.doesNotMatch(competitors, /google_place_id'\)\.notNull\(\)/);
  });

  test('competitor_menu_snapshots carries the menu tracking columns', () => {
    const snapshots = table(schema, 'export const competitorMenuSnapshots = pgTable(');
    assert.match(snapshots, /references\(\(\) => competitors\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(snapshots, /menuUrl:\s*text\('menu_url'\)/);
    assert.match(snapshots, /menuText:\s*text\('menu_text'\)/);
    assert.match(snapshots, /priceRange:\s*text\('price_range'\)/);
    assert.match(snapshots, /snapshotAt:\s*timestamp\('snapshot_at'\)\.defaultNow\(\)\.notNull\(\)/);
    assert.match(
      snapshots,
      /index\('competitor_menu_snapshots_competitor_idx'\)\.on\(table\.competitorId\)/
    );
  });

  test('competitor_promotions carries the promotion tracking columns', () => {
    const promotions = table(schema, 'export const competitorPromotions = pgTable(');
    assert.match(promotions, /references\(\(\) => competitors\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(promotions, /promotionText:\s*text\('promotion_text'\)\.notNull\(\)/);
    assert.match(promotions, /source:\s*text\('source'\)/);
    assert.match(promotions, /detectedAt:\s*timestamp\('detected_at'\)\.defaultNow\(\)\.notNull\(\)/);
    assert.match(promotions, /index\('competitor_promotions_competitor_idx'\)\.on\(table\.competitorId\)/);
  });

  test('market_opportunities is tenant-scoped and unique per (tenant, key)', () => {
    const opportunities = table(schema, 'export const marketOpportunities = pgTable(');
    assert.match(opportunities, /references\(\(\) => tenants\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(opportunities, /key:\s*text\('key'\)\.notNull\(\)/);
    assert.match(opportunities, /opportunityType:\s*text\('opportunity_type'\)\.notNull\(\)/);
    assert.match(opportunities, /confidence:\s*numeric\('confidence'\)\.default\('0'\)\.notNull\(\)/);
    assert.match(opportunities, /evidence:\s*jsonb\('evidence'\)\.default\(\[\]\)\.notNull\(\)/);
    assert.match(opportunities, /addressed:\s*boolean\('addressed'\)\.default\(false\)\.notNull\(\)/);
    assert.match(opportunities, /index\('market_opportunities_tenant_idx'\)\.on\(table\.tenantId\)/);
    assert.match(
      opportunities,
      /uniqueIndex\('market_opportunities_tenant_key_uniq'\)\.on\(table\.tenantId,\s*table\.key\)/
    );
  });

  test('tenants carries the discovery origin and its own menu', () => {
    const tenants = table(schema, 'export const tenants = pgTable(');
    assert.match(tenants, /address:\s*text\('address'\)/);
    assert.match(tenants, /latitude:\s*numeric\('latitude'\)/);
    assert.match(tenants, /longitude:\s*numeric\('longitude'\)/);
    assert.match(tenants, /menuText:\s*text\('menu_text'\)/);
  });

  test('relations expose the market tables', () => {
    assert.match(schema, /marketOpportunities:\s*many\(marketOpportunities\)/);
    assert.match(schema, /menuSnapshots:\s*many\(competitorMenuSnapshots\)/);
    assert.match(schema, /promotions:\s*many\(competitorPromotions\)/);
  });

  test('0012 migration carries the same DDL as the schema', () => {
    const src = source(MIGRATION_0012);
    for (const col of ['address', 'latitude', 'longitude', 'distance_km', 'website_url', 'phone', 'place_data', 'updated_at']) {
      assert.ok(
        src.includes(`ADD COLUMN IF NOT EXISTS "${col}"`),
        `0012 migration is missing competitors.${col}`
      );
    }
    assert.match(src, /ALTER COLUMN "google_place_id" DROP NOT NULL/);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "competitor_menu_snapshots"/);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "competitor_promotions"/);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "market_opportunities"/);
    for (const idx of [
      'competitors_distance_idx',
      'competitor_menu_snapshots_competitor_idx',
      'competitor_promotions_competitor_idx',
      'market_opportunities_tenant_idx',
      'market_opportunities_tenant_key_uniq',
    ]) {
      assert.ok(src.includes(idx), `0012 migration is missing index ${idx}`);
    }
    for (const col of ['address', 'latitude', 'longitude', 'menu_text']) {
      assert.ok(
        src.includes(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "${col}"`),
        `0012 migration is missing tenants.${col}`
      );
    }
  });

  test('0012 is additive: no DROP TABLE, no dropped column, no data rewrite', () => {
    // Mutation guard. The one intentional non-additive statement is the
    // google_place_id DROP NOT NULL — relaxing a constraint can lose nothing.
    const src = sql(MIGRATION_0012);
    assert.doesNotMatch(src, /DROP\s+TABLE/i);
    assert.doesNotMatch(src, /DROP\s+COLUMN/i);
    assert.doesNotMatch(src, /TRUNCATE/i);
    assert.doesNotMatch(src, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(src, /\bUPDATE\s+competitors\b/i);
    // Counted with an exec loop rather than [...matchAll()]: the repo's
    // tsconfig targets ES5, where spreading a RegExp iterator needs
    // downlevelIteration.
    let drops = 0;
    for (const re = /DROP\s+NOT\s+NULL/gi; re.exec(src) !== null; ) drops += 1;
    assert.equal(drops, 1, 'expected exactly one DROP NOT NULL (google_place_id)');
  });

  test('migration journal registers 0012_competitors', () => {
    const journal = JSON.parse(source(JOURNAL));
    const entry = journal.entries.find((e: { tag: string }) => e.tag === '0012_competitors');
    assert.ok(entry, 'journal has no 0012_competitors entry');
    assert.equal(entry.idx, 11);
    const whens = journal.entries.map((e: { when: number }) => e.when);
    assert.deepEqual(whens, [...whens].sort((a, b) => a - b), 'journal entries are not chronological');
  });

  test('migration journal registers 0016_billing_onboarding_consent', () => {
    const journal = JSON.parse(source(JOURNAL));
    const entry = journal.entries.find((e: { tag: string }) => e.tag === '0016_billing_onboarding_consent');
    assert.ok(entry, 'journal has no 0016_billing_onboarding_consent entry');
  });

  test('migration journal is current through 0020_cron_key_demo_mode', () => {
    const journal = JSON.parse(source(JOURNAL));
    for (const tag of [
      '0017_magic_link',
      '0018_missing_engines',
      '0019_tenant_memberships',
      '0020_cron_key_demo_mode',
    ]) {
      assert.ok(
        journal.entries.find((e: { tag: string }) => e.tag === tag),
        `journal has no ${tag} entry`
      );
    }
    const latest = journal.entries[journal.entries.length - 1];
    assert.equal(latest.tag, '0020_cron_key_demo_mode');
  });

  test('/api/migrate carries the same Gate #15-#18 DDL', () => {
    const route = code(MIGRATE_DDL_FILE);
    const section = from(route, 'ALTER TABLE competitors ADD COLUMN IF NOT EXISTS address');
    for (const col of ['latitude', 'longitude', 'distance_km', 'website_url', 'phone', 'place_data', 'updated_at']) {
      assert.match(section, new RegExp(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS ${col}`));
    }
    assert.match(route, /ALTER TABLE competitors ALTER COLUMN google_place_id DROP NOT NULL/);
    assert.match(route, /competitors_distance_idx/);
    assert.match(route, /CREATE TABLE IF NOT EXISTS competitor_menu_snapshots/);
    assert.match(route, /competitor_menu_snapshots_competitor_idx/);
    assert.match(route, /CREATE TABLE IF NOT EXISTS competitor_promotions/);
    assert.match(route, /competitor_promotions_competitor_idx/);
    assert.match(route, /CREATE TABLE IF NOT EXISTS market_opportunities/);
    assert.match(route, /market_opportunities_tenant_key_uniq/);
    assert.match(route, /ALTER TABLE tenants ADD COLUMN IF NOT EXISTS menu_text text/);
  });
});
