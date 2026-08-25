import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const STORE = join(HERE, 'campaign-store.ts');
const API = join(APP, 'api', 'marketing', 'campaigns', 'route.ts');
const PAGE = join(APP, 'dashboard', 'marketing', 'campaigns', 'page.tsx');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0014_marketing_campaigns.sql');
const JOURNAL = join(HERE, '..', '..', 'drizzle', 'meta', '_journal.json');
const MIGRATE_ROUTE = join(APP, 'api', 'migrate', 'route.ts');

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

describe('marketing campaign schema wiring', () => {
  test('schema defines marketing_campaigns with tenant FK and marketing columns', () => {
    const src = code(SCHEMA);
    const table = from(src, 'export const marketingCampaigns = pgTable(');
    assert.match(table, /uuid\('tenant_id'\)/);
    assert.match(table, /references\(\(\) => tenants\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(table, /text\('name'\)\.notNull\(\)/);
    assert.match(table, /text\('description'\)/);
    assert.match(table, /text\('type',\s*\{\s*enum:\s*\['promotion',\s*'event',\s*'seasonal',\s*'announcement',\s*'custom'\]\s*\}\)\.notNull\(\)/);
    assert.match(table, /text\('target_segment'\)/);
    assert.match(table, /text\('offer'\)/);
    assert.match(table, /text\('message'\)\.notNull\(\)/);
    assert.match(table, /timestamp\('start_date'\)/);
    assert.match(table, /timestamp\('end_date'\)/);
    assert.match(table, /timestamp\('launched_at'\)/);
    assert.match(table, /integer\('estimated_reach'\)/);
    assert.match(table, /integer\('estimated_revenue_cents'\)/);
    assert.match(table, /text\('status',\s*\{\s*enum:\s*\['draft',\s*'scheduled',\s*'sent',\s*'failed'\]\s*\}\)\.default\('draft'\)\.notNull\(\)/);
  });

  test('schema declares marketing campaign indexes', () => {
    const src = code(SCHEMA);
    const table = from(src, 'export const marketingCampaigns = pgTable(');
    assert.match(table, /index\('marketing_campaigns_tenant_idx'\)\.on\(table\.tenantId\)/);
    assert.match(table, /index\('marketing_campaigns_tenant_status_idx'\)\.on\(table\.tenantId,\s*table\.status\)/);
    assert.match(table, /index\('marketing_campaigns_tenant_type_idx'\)\.on\(table\.tenantId,\s*table\.type\)/);
  });

  test('tenant relations expose marketingCampaigns', () => {
    const src = code(SCHEMA);
    assert.match(src, /marketingCampaigns:\s*many\(marketingCampaigns\)/);
  });

  test('0014 migration creates marketing_campaigns with matching DDL', () => {
    const src = source(MIGRATION);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "marketing_campaigns"/);
    assert.match(src, /"tenant_id" uuid NOT NULL REFERENCES tenants\(id\) ON DELETE CASCADE/);
    assert.match(src, /"name" text NOT NULL/);
    assert.match(src, /"type" text NOT NULL/);
    assert.match(src, /"message" text NOT NULL/);
    assert.match(src, /"status" text DEFAULT 'draft' NOT NULL/);
    assert.match(src, /marketing_campaigns_tenant_idx/);
    assert.match(src, /marketing_campaigns_tenant_status_idx/);
    assert.match(src, /marketing_campaigns_tenant_type_idx/);
  });

  test('migration journal and /api/migrate include Engine 5 DDL', () => {
    const journal = JSON.parse(source(JOURNAL));
    assert.ok(
      journal.entries.some((entry: { tag: string }) => entry.tag === '0014_marketing_campaigns'),
      'journal has no 0014_marketing_campaigns entry'
    );
    const route = code(MIGRATE_ROUTE);
    assert.match(route, /CREATE TABLE IF NOT EXISTS marketing_campaigns/);
    assert.match(route, /marketing_campaigns_tenant_status_idx/);
    assert.match(route, /marketing_campaigns_tenant_type_idx/);
  });
});

describe('marketing campaign store wiring', () => {
  test('all reads and writes are tenant-scoped', () => {
    const src = code(STORE);
    for (const fn of [
      'export async function listMarketingCampaigns',
      'export async function getMarketingCampaign',
      'export async function createMarketingCampaign',
      'export async function updateMarketingCampaign',
      'export async function deleteMarketingCampaign',
      'export async function countMarketingCampaigns',
    ]) {
      assert.match(from(src, fn), /eq\(marketingCampaigns\.tenantId,\s*tenantId\)/, `${fn} is not tenant-scoped`);
    }
  });

  test('create requires name, message, and type', () => {
    const body = from(code(STORE), 'export async function createMarketingCampaign');
    assert.match(body, /name:\s*input\.name/);
    assert.match(body, /message:\s*input\.message/);
    assert.match(body, /type:\s*input\.type/);
  });

  test('update only sets provided fields', () => {
    const body = from(code(STORE), 'export async function updateMarketingCampaign');
    assert.match(body, /input\.name !== undefined/);
    assert.match(body, /input\.message !== undefined/);
    assert.match(body, /input\.type !== undefined/);
  });

  test('delete filters by tenant and id', () => {
    const body = from(code(STORE), 'export async function deleteMarketingCampaign');
    assert.match(body, /eq\(marketingCampaigns\.id,\s*campaignId\)/);
    assert.match(body, /eq\(marketingCampaigns\.tenantId,\s*tenantId\)/);
  });
});

describe('marketing campaign API wiring', () => {
  test('GET lists campaigns for the signed-in tenant', () => {
    const src = code(API);
    assert.match(src, /getOrCreateTenant\(\)/);
    assert.match(src, /listMarketingCampaigns\(tenant\.id\)/);
    assert.match(src, /401/);
  });

  test('POST validates required fields and type enum', () => {
    const src = code(API);
    const body = from(src, 'export async function POST');
    assert.match(body, /name/);
    assert.match(body, /message/);
    assert.match(body, /type/);
    assert.match(body, /\['promotion',\s*'event',\s*'seasonal',\s*'announcement',\s*'custom'\]/);
    assert.match(body, /201/);
  });
});

describe('marketing campaign dashboard wiring', () => {
  test('page renders campaign list with type and status badges', () => {
    const src = source(PAGE);
    assert.match(src, /listMarketingCampaigns\(tenant\.id\)/);
    assert.match(src, /promotion/);
    assert.match(src, /draft/);
    assert.match(src, /redirect\('\/sign-in'\)/);
  });
});
