import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const STORE = join(HERE, 'event-store.ts');
const API = join(APP, 'api', 'marketing', 'events', 'route.ts');
const PAGE = join(APP, '(app)', 'dashboard', 'marketing', 'events', 'page.tsx');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0015_marketing_events.sql');
const JOURNAL = join(HERE, '..', '..', 'drizzle', 'meta', '_journal.json');
// The /api/migrate DDL was lifted verbatim out of the route handler into
// lib/db/migrate-ddl.ts so it can be EXECUTED by lib/db/migrate-execute.test.ts.
// These assertions check the same statements, now at their real home.
const MIGRATE_DDL_FILE = join(APP, '..', 'lib', 'db', 'migrate-ddl.ts');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

describe('marketing event schema wiring', () => {
  test('schema defines marketing_events with tenant FK and event columns', () => {
    const src = code(SCHEMA);
    const table = from(src, 'export const marketingEvents = pgTable(');
    assert.match(table, /uuid\('tenant_id'\)/);
    assert.match(table, /references\(\(\) => tenants\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(table, /text\('name'\)\.notNull\(\)/);
    assert.match(table, /text\('event_type',\s*\{\s*enum:\s*\['special',\s*'live_music',\s*'tasting',\s*'workshop',\s*'holiday',\s*'custom'\]\s*\}\)\.notNull\(\)/);
    assert.match(table, /timestamp\('starts_at'\)\.notNull\(\)/);
    assert.match(table, /timestamp\('ends_at'\)\.notNull\(\)/);
    assert.match(table, /integer\('capacity'\)/);
    assert.match(table, /integer\('booked_count'\)\.default\(0\)/);
    assert.match(table, /text\('status',\s*\{\s*enum:\s*\['draft',\s*'published',\s*'cancelled',\s*'completed'\]\s*\}\)\.default\('draft'\)\.notNull\(\)/);
  });

  test('schema declares marketing event indexes', () => {
    const src = code(SCHEMA);
    const table = from(src, 'export const marketingEvents = pgTable(');
    assert.match(table, /index\('marketing_events_tenant_idx'\)\.on\(table\.tenantId\)/);
    assert.match(table, /index\('marketing_events_tenant_status_idx'\)\.on\(table\.tenantId,\s*table\.status\)/);
    assert.match(table, /index\('marketing_events_tenant_type_idx'\)\.on\(table\.tenantId,\s*table\.eventType\)/);
  });

  test('tenant relations expose marketingEvents', () => {
    const src = code(SCHEMA);
    assert.match(src, /marketingEvents:\s*many\(marketingEvents\)/);
  });

  test('0015 migration creates marketing_events with matching DDL', () => {
    const src = source(MIGRATION);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "marketing_events"/);
    assert.match(src, /"tenant_id" uuid NOT NULL REFERENCES tenants\(id\) ON DELETE CASCADE/);
    assert.match(src, /"name" text NOT NULL/);
    assert.match(src, /"event_type" text NOT NULL/);
    assert.match(src, /"starts_at" timestamp NOT NULL/);
    assert.match(src, /"ends_at" timestamp NOT NULL/);
    assert.match(src, /"capacity" integer/);
    assert.match(src, /"booked_count" integer DEFAULT 0 NOT NULL/);
    assert.match(src, /"status" text DEFAULT 'draft' NOT NULL/);
    assert.match(src, /marketing_events_tenant_idx/);
    assert.match(src, /marketing_events_tenant_status_idx/);
    assert.match(src, /marketing_events_tenant_type_idx/);
  });

  test('migration journal and /api/migrate include Engine 5 DDL', () => {
    const journal = JSON.parse(source(JOURNAL));
    assert.ok(
      journal.entries.some((entry: { tag: string }) => entry.tag === '0015_marketing_events'),
      'journal has no 0015_marketing_events entry'
    );
    const route = code(MIGRATE_DDL_FILE);
    assert.match(route, /CREATE TABLE IF NOT EXISTS marketing_events/);
    assert.match(route, /marketing_events_tenant_status_idx/);
    assert.match(route, /marketing_events_tenant_type_idx/);
  });
});

describe('marketing event store wiring', () => {
  test('all reads and writes are tenant-scoped', () => {
    const src = code(STORE);
    for (const fn of [
      'export async function listMarketingEvents',
      'export async function getMarketingEvent',
      'export async function createMarketingEvent',
      'export async function updateMarketingEvent',
      'export async function deleteMarketingEvent',
      'export async function countMarketingEvents',
    ]) {
      assert.match(from(src, fn), /eq\(marketingEvents\.tenantId,\s*tenantId\)/, `${fn} is not tenant-scoped`);
    }
  });

  test('create requires name, event_type, starts_at, and ends_at', () => {
    const body = from(code(STORE), 'export async function createMarketingEvent');
    assert.match(body, /name:\s*input\.name/);
    assert.match(body, /eventType:\s*input\.eventType/);
    assert.match(body, /startsAt:\s*input\.startsAt/);
    assert.match(body, /endsAt:\s*input\.endsAt/);
  });

  test('update only sets provided fields', () => {
    const body = from(code(STORE), 'export async function updateMarketingEvent');
    assert.match(body, /input\.name !== undefined/);
    assert.match(body, /input\.eventType !== undefined/);
    assert.match(body, /input\.status !== undefined/);
  });

  test('delete filters by tenant and id', () => {
    const body = from(code(STORE), 'export async function deleteMarketingEvent');
    assert.match(body, /eq\(marketingEvents\.id,\s*eventId\)/);
    assert.match(body, /eq\(marketingEvents\.tenantId,\s*tenantId\)/);
  });
});

describe('marketing event API wiring', () => {
  test('GET lists events for the signed-in tenant', () => {
    const src = code(API);
    assert.match(src, /getOrCreateTenant\(\)/);
    assert.match(src, /listMarketingEvents\(tenant\.id\)/);
    assert.match(src, /401/);
  });

  test('POST validates required fields, event type enum, and date order', () => {
    const src = code(API);
    const body = from(src, 'export async function POST');
    assert.match(body, /name/);
    assert.match(body, /event_type/);
    assert.match(body, /starts_at/);
    assert.match(body, /ends_at/);
    assert.match(body, /\['special',\s*'live_music',\s*'tasting',\s*'workshop',\s*'holiday',\s*'custom'\]/);
    assert.match(body, /endsAt <= startsAt/);
    assert.match(body, /201/);
  });
});

describe('marketing event dashboard wiring', () => {
  test('page renders event list with type and status badges', () => {
    const src = source(PAGE);
    assert.match(src, /listMarketingEvents\(tenant\.id\)/);
    assert.match(src, /special/);
    assert.match(src, /draft/);
    assert.match(src, /redirect\('\/sign-in'\)/);
  });
});
