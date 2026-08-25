import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIZZLE = join(HERE, '..', '..', 'drizzle');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const MIGRATION_0009 = join(DRIZZLE, '0009_google_reviews.sql');
const MIGRATION_0010 = join(DRIZZLE, '0010_review_requests.sql');
const MIGRATION_0011 = join(DRIZZLE, '0011_competitor_ratings.sql');
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

describe('Reputation schema wiring (Gates #11-#14)', () => {
  test('schema defines google_reviews with the gate contract columns', () => {
    const table = from(code(SCHEMA), 'export const googleReviews = pgTable(');
    assert.match(table, /uuid\('tenant_id'\)/);
    assert.match(table, /references\(\(\) => tenants\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(table, /text\('google_place_id'\)\.notNull\(\)/);
    assert.match(table, /text\('review_id'\)\.notNull\(\)\.unique\(\)/);
    assert.match(table, /text\('author_name'\)\.notNull\(\)/);
    assert.match(table, /integer\('rating'\)\.notNull\(\)/);
    assert.match(table, /text\('text'\)/);
    assert.match(table, /timestamp\('time'\)\.notNull\(\)/);
    assert.match(table, /text\('sentiment',\s*\{\s*enum:\s*\['positive',\s*'neutral',\s*'negative'\]/);
    assert.match(table, /text\('response_text'\)/);
    assert.match(table, /timestamp\('response_sent_at'\)/);
    assert.match(table, /timestamp\('created_at'\)\.defaultNow\(\)/);
  });

  test('schema declares all four google review indexes', () => {
    const table = from(code(SCHEMA), 'export const googleReviews = pgTable(');
    assert.match(table, /index\('google_reviews_tenant_idx'\)\.on\(table\.tenantId\)/);
    assert.match(table, /index\('google_reviews_rating_idx'\)\.on\(table\.rating\)/);
    assert.match(table, /index\('google_reviews_time_idx'\)\.on\(table\.time\)/);
    const config = from(code(SCHEMA), 'export const googlePlacesConfig = pgTable(');
    assert.match(config, /index\('google_places_config_tenant_idx'\)\.on\(table\.tenantId\)/);
  });

  test('google_places_config is one row per tenant (unique tenant_id)', () => {
    const config = from(code(SCHEMA), 'export const googlePlacesConfig = pgTable(');
    assert.match(config, /uniqueIndex\('google_places_config_tenant_uniq'\)\.on\(table\.tenantId\)/);
    assert.match(config, /text\('place_id'\)\.notNull\(\)/);
    assert.match(config, /text\('api_key_encrypted'\)/);
    assert.match(config, /timestamp\('last_fetch_at'\)/);
  });

  test('reservations gains the review-request dedup columns and partial index', () => {
    const table = from(code(SCHEMA), 'export const reservations = pgTable(');
    assert.match(table, /boolean\('review_request_sent'\)\.default\(false\)\.notNull\(\)/);
    assert.match(table, /timestamp\('review_request_sent_at'\)/);
    assert.match(table, /index\('reservations_review_request_idx'\)/);
    assert.match(table, /\.on\(table\.reviewRequestSent,\s*table\.date\)/);
  });

  test('schema defines competitors + rating history with their indexes', () => {
    const competitors = from(code(SCHEMA), 'export const competitors = pgTable(');
    assert.match(competitors, /uuid\('tenant_id'\)/);
    assert.match(competitors, /references\(\(\) => tenants\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(competitors, /text\('name'\)\.notNull\(\)/);
    // Gate #15 relaxed this column to nullable: hand-added and market-discovered
    // competitors have no Google listing, and the rating sweep skips those rows
    // (see lib/reputation/competitor-ratings.ts -> skipped.noPlaceId).
    assert.match(competitors, /googlePlaceId:\s*text\('google_place_id'\),/);
    assert.match(competitors, /numeric\('current_rating'\)\.default\('0'\)/);
    assert.match(competitors, /integer\('review_count'\)\.default\(0\)/);
    assert.match(competitors, /index\('competitors_tenant_idx'\)\.on\(table\.tenantId\)/);

    const history = from(code(SCHEMA), 'export const competitorRatingHistory = pgTable(');
    assert.match(history, /uuid\('competitor_id'\)/);
    assert.match(history, /references\(\(\) => competitors\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(history, /numeric\('rating'\)\.notNull\(\)/);
    assert.match(history, /integer\('review_count'\)\.notNull\(\)/);
    assert.match(history, /index\('competitor_rating_history_competitor_idx'\)\.on\(table\.competitorId\)/);
  });

  test('tenant relations expose the reputation tables', () => {
    const relations = code(SCHEMA);
    assert.match(relations, /googleReviews:\s*many\(googleReviews\)/);
    assert.match(relations, /competitors:\s*many\(competitors\)/);
  });

  test('0009 migration creates both tables with matching DDL', () => {
    const src = source(MIGRATION_0009);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "google_reviews"/);
    assert.match(src, /"review_id" text NOT NULL UNIQUE/);
    assert.match(src, /"sentiment" text DEFAULT 'neutral' NOT NULL/);
    assert.match(src, /"response_text" text/);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "google_places_config"/);
    assert.match(src, /"api_key_encrypted" text/);
    assert.match(src, /"last_fetch_at" timestamp/);
    for (const idx of [
      'google_reviews_tenant_idx',
      'google_reviews_rating_idx',
      'google_reviews_time_idx',
      'google_places_config_tenant_uniq',
      'google_places_config_tenant_idx',
    ]) {
      assert.ok(src.includes(idx), `0009 migration is missing index ${idx}`);
    }
  });

  test('0010 migration adds the reservation columns and partial index', () => {
    const src = source(MIGRATION_0010);
    assert.match(src, /ADD COLUMN IF NOT EXISTS "review_request_sent" boolean DEFAULT false NOT NULL/);
    assert.match(src, /ADD COLUMN IF NOT EXISTS "review_request_sent_at" timestamp/);
    assert.match(src, /reservations_review_request_idx/);
  });

  test('0011 migration creates both competitor tables with their indexes', () => {
    const src = source(MIGRATION_0011);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "competitors"/);
    assert.match(src, /"google_place_id" text NOT NULL/);
    assert.match(src, /"current_rating" numeric DEFAULT '0' NOT NULL/);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "competitor_rating_history"/);
    assert.match(src, /competitors_tenant_idx/);
    assert.match(src, /competitor_rating_history_competitor_idx/);
  });

  test('migration journal and /api/migrate carry all three gates', () => {
    const journal = JSON.parse(source(JOURNAL));
    for (const tag of ['0009_google_reviews', '0010_review_requests', '0011_competitor_ratings']) {
      assert.ok(
        journal.entries.some((entry: { tag: string }) => entry.tag === tag),
        `journal has no ${tag} entry`
      );
    }
    const route = code(MIGRATE_ROUTE);
    assert.match(route, /CREATE TABLE IF NOT EXISTS google_reviews/);
    assert.match(route, /CREATE TABLE IF NOT EXISTS google_places_config/);
    assert.match(route, /review_request_sent/);
    assert.match(route, /reservations_review_request_idx/);
    assert.match(route, /CREATE TABLE IF NOT EXISTS competitors/);
    assert.match(route, /CREATE TABLE IF NOT EXISTS competitor_rating_history/);
    assert.match(route, /competitor_rating_history_competitor_idx/);
  });
});
