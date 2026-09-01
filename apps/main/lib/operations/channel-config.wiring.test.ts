import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const STORE = join(HERE, 'channel-config-store.ts');
const API = join(APP, 'api', 'operations', 'channel-configs', 'route.ts');
const PAGE = join(APP, '(app)', 'dashboard', 'operations', 'channel-configs', 'page.tsx');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0013_engine6_operations.sql');
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

describe('channel config schema wiring', () => {
  test('schema defines channel_configs with tenant FK and unique channel constraint', () => {
    const src = code(SCHEMA);
    const table = from(src, 'export const channelConfigs = pgTable(');
    assert.match(table, /uuid\('tenant_id'\)/);
    assert.match(table, /references\(\(\) => tenants\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(table, /text\('channel',\s*\{\s*enum:\s*\['whatsapp',\s*'email',\s*'instagram',\s*'facebook',\s*'web'\]\s*\}\)\.notNull\(\)/);
    assert.match(table, /text\('credentials_encrypted'\)/);
    assert.match(table, /boolean\('enabled'\)\.default\(false\)\.notNull\(\)/);
    assert.match(table, /uniqueIndex\('channel_configs_tenant_channel_idx'\)\.on\(table\.tenantId,\s*table\.channel\)/);
  });

  test('tenant relations expose channelConfigs', () => {
    const src = code(SCHEMA);
    assert.match(src, /channelConfigs:\s*many\(channelConfigs\)/);
  });

  test('schema adds channel and external_id to conversations', () => {
    const src = code(SCHEMA);
    const table = from(src, 'export const conversations = pgTable(');
    assert.match(table, /text\('channel',\s*\{\s*enum:\s*\['whatsapp',\s*'email',\s*'instagram',\s*'facebook',\s*'web'\]\s*}\)/);
    assert.match(table, /\.default\s*\(\s*'whatsapp'\s*\)\s*\.\s*notNull\s*\(\s*\)/);
    assert.match(table, /text\('external_id'\)/);
    assert.match(table, /index\('conversations_tenant_channel_idx'\)\.on\(table\.tenantId,\s*table\.channel\)/);
    assert.match(table, /index\('conversations_tenant_external_idx'\)\.on\(table\.tenantId,\s*table\.externalId\)/);
  });

  test('schema enriches campaigns with marketing columns', () => {
    const src = code(SCHEMA);
    const table = from(src, 'export const campaigns = pgTable(');
    assert.match(table, /text\('description'\)/);
    assert.match(table, /text\('target_segment'\)/);
    assert.match(table, /text\('offer'\)/);
    assert.match(table, /timestamp\('start_date'\)/);
    assert.match(table, /timestamp\('end_date'\)/);
    assert.match(table, /timestamp\('launched_at'\)/);
    assert.match(table, /integer\('estimated_reach'\)/);
    assert.match(table, /integer\('estimated_revenue_cents'\)/);
    assert.match(table, /index\('campaigns_tenant_status_idx'\)\.on\(table\.tenantId,\s*table\.status\)/);
  });

  test('0013 migration creates channel_configs, approval_requests, and additive ALTERs', () => {
    const src = source(MIGRATION);
    assert.match(src, /ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel text DEFAULT 'whatsapp' NOT NULL/);
    assert.match(src, /ALTER TABLE conversations ADD COLUMN IF NOT EXISTS external_id text/);
    assert.match(src, /ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS description text/);
    assert.match(src, /CREATE TABLE IF NOT EXISTS channel_configs/);
    assert.match(src, /CREATE UNIQUE INDEX IF NOT EXISTS channel_configs_tenant_channel_idx ON channel_configs \(tenant_id, channel\)/);
    assert.match(src, /CREATE TABLE IF NOT EXISTS approval_requests/);
    assert.match(src, /risk_level text NOT NULL/);
    assert.match(src, /status text DEFAULT 'pending' NOT NULL/);
  });

  test('migration journal and /api/migrate include Engine 6 DDL', () => {
    const journal = JSON.parse(source(JOURNAL));
    assert.ok(
      journal.entries.some((entry: { tag: string }) => entry.tag === '0013_engine6_operations'),
      'journal has no 0013_engine6_operations entry'
    );
    const route = code(MIGRATE_DDL_FILE);
    assert.match(route, /ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel text DEFAULT 'whatsapp' NOT NULL/);
    assert.match(route, /CREATE TABLE IF NOT EXISTS channel_configs/);
    assert.match(route, /channel_configs_tenant_channel_idx/);
    assert.match(route, /CREATE TABLE IF NOT EXISTS approval_requests/);
    assert.match(route, /approval_requests_tenant_status_idx/);
  });
});

describe('channel config store wiring', () => {
  test('all reads and writes are tenant-scoped', () => {
    const src = code(STORE);
    for (const fn of [
      'export async function listChannelConfigs',
      'export async function getChannelConfig',
      'export async function upsertChannelConfig',
      'export async function deleteChannelConfig',
    ]) {
      assert.match(from(src, fn), /eq\(channelConfigs\.tenantId,\s*tenantId\)/, `${fn} is not tenant-scoped`);
    }
  });

  test('upsert returns existing row when channel already exists', () => {
    const body = from(code(STORE), 'export async function upsertChannelConfig');
    assert.match(body, /getChannelConfig\(input\.tenantId,\s*input\.channel\)/);
    assert.match(body, /db\.update\(channelConfigs\)/);
  });

  test('delete filters by tenant and channel', () => {
    const body = from(code(STORE), 'export async function deleteChannelConfig');
    assert.match(body, /eq\(channelConfigs\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(channelConfigs\.channel,/);
  });
});

describe('channel config API wiring', () => {
  test('GET lists configs for the signed-in tenant', () => {
    const src = code(API);
    assert.match(src, /getOrCreateTenant\(\)/);
    assert.match(src, /listChannelConfigs\(tenant\.id\)/);
    assert.match(src, /401/);
  });

  test('POST validates channel enum and upserts', () => {
    const src = code(API);
    const body = from(src, 'export async function POST');
    assert.match(body, /allowed\.includes\(channel\)/);
    assert.match(body, /upsertChannelConfig\(/);
    assert.match(body, /201/);
  });

  test('DELETE removes by tenant + channel', () => {
    const src = code(API);
    const body = from(src, 'export async function DELETE');
    assert.match(body, /url\.searchParams\.get\('channel'\)/);
    assert.match(body, /deleteChannelConfig\(tenant\.id,\s*channel\)/);
    assert.match(body, /404/);
  });
});

describe('channel config dashboard wiring', () => {
  test('page renders channel cards with enabled/disabled state', () => {
    const src = source(PAGE);
    assert.match(src, /listChannelConfigs\(tenant\.id\)/);
    // UI-3R/F4: WhatsApp reads the LIVE wa_accounts connection; wording is
    // owner language (Connected / Not connected) instead of Enabled/Disabled.
    assert.match(src, /waAccounts/);
    assert.match(src, /Connected/);
    assert.match(src, /Not connected/);
    assert.match(src, /redirect\('\/sign-in'\)/);
  });
});
