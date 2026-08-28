import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0005_customer_profiles.sql');
const JOURNAL = join(HERE, '..', '..', 'drizzle', 'meta', '_journal.json');
// The /api/migrate DDL was lifted verbatim out of the route handler into
// lib/db/migrate-ddl.ts so it can be EXECUTED by lib/db/migrate-execute.test.ts.
// These assertions check the same statements, now at their real home.
const MIGRATE_DDL_FILE = join(APP, '..', 'lib', 'db', 'migrate-ddl.ts');
const BUILDER = join(HERE, 'profile-builder.ts');
const STORE = join(HERE, 'profile-store.ts');
const LIST_API = join(APP, 'api', 'customer', 'profiles', 'route.ts');
const DETAIL_API = join(APP, 'api', 'customer', 'profiles', '[customer_phone]', 'route.ts');
const LIST_PAGE = join(APP, 'dashboard', 'customers', 'page.tsx');
const DETAIL_PAGE = join(APP, 'dashboard', 'customers', '[customer_phone]', 'page.tsx');
const LAYOUT = join(APP, 'dashboard', 'layout.tsx');

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

describe('schema and migrations agree', () => {
  test('schema declares customer_profiles with required columns and indexes', () => {
    const src = code(SCHEMA);
    assert.match(src, /export const customerProfiles = pgTable\(\s*'customer_profiles'/);
    assert.match(src, /customerPhone:\s*text\('customer_phone'\)\.notNull\(\)/);
    assert.match(src, /contactId:\s*uuid\('contact_id'\)/);
    assert.match(src, /totalSpendCents:\s*integer\('total_spend_cents'\)/);
    assert.match(src, /avgPartySize:\s*numeric\('avg_party_size'\)/);
    assert.match(src, /preferences:\s*jsonb\('preferences'\)/);
    assert.match(src, /index\('customer_profiles_tenant_idx'\)/);
    assert.match(src, /index\('customer_profiles_phone_idx'\)/);
    assert.match(src, /index\('customer_profiles_contact_idx'\)/);
  });

  test('migration 0005 creates the table and indexes', () => {
    const src = readFileSync(MIGRATION, 'utf8');
    assert.match(src, /CREATE TABLE IF NOT EXISTS "customer_profiles"/);
    assert.match(src, /customer_profiles_tenant_idx/);
    assert.match(src, /customer_profiles_phone_idx/);
    assert.match(src, /customer_profiles_contact_idx/);
  });

  test('journal lists 0005_customer_profiles', () => {
    const journal = JSON.parse(readFileSync(JOURNAL, 'utf8'));
    assert.ok(journal.entries.some((e: { tag: string }) => e.tag === '0005_customer_profiles'));
  });

  test('/api/migrate applies the same DDL', () => {
    const src = code(MIGRATE_DDL_FILE);
    assert.match(src, /CREATE TABLE IF NOT EXISTS customer_profiles/);
    assert.match(src, /customer_profiles_tenant_idx/);
    assert.match(src, /customer_profiles_contact_idx/);
  });
});

describe('seam: builder is framework-free', () => {
  test('imports no database or Next modules', () => {
    const src = code(BUILDER);
    assert.doesNotMatch(src, /from\s+['"]@\/lib\/db['"]/);
    assert.doesNotMatch(src, /from\s+['"]next\//);
    assert.doesNotMatch(src, /from\s+['"]drizzle-orm['"]/);
  });
});

describe('seam: store is tenant-scoped', () => {
  const src = code(STORE);

  test('getProfile filters tenant_id and phone', () => {
    const body = from(src, 'export async function getProfile');
    assert.match(body, /eq\(customerProfiles\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(customerProfiles\.customerPhone,\s*customerPhone\)/);
  });

  test('listProfiles and countProfiles filter tenant_id', () => {
    assert.match(from(src, 'export async function listProfiles'), /eq\(customerProfiles\.tenantId,\s*tenantId\)/);
    assert.match(from(src, 'export async function countProfiles'), /eq\(customerProfiles\.tenantId,\s*tenantId\)/);
  });

  test('reservation loads are tenant-scoped', () => {
    assert.match(src, /eq\(reservations\.tenantId,\s*tenantId\)/);
  });

  test('createReservationAndSyncProfile inserts then syncs', () => {
    const body = from(src, 'export async function createReservationAndSyncProfile');
    assert.match(body, /\.insert\(reservations\)/);
    assert.match(body, /updateProfileAfterReservation/);
  });
});

describe('API routes require a tenant and stay scoped', () => {
  test('GET /api/customer/profiles lists for the signed-in tenant', () => {
    const src = code(LIST_API);
    assert.match(src, /getOrCreateTenant/);
    assert.match(src, /listProfiles\(tenant\.id/);
    assert.match(src, /countProfiles\(tenant\.id\)/);
    assert.match(src, /status:\s*401/);
  });

  test('GET /api/customer/profiles/{phone} returns profile + visits', () => {
    const src = code(DETAIL_API);
    assert.match(src, /getOrCreateTenant/);
    assert.match(src, /getProfile\(tenant\.id,\s*customerPhone\)/);
    assert.match(src, /listVisitHistory\(tenant\.id/);
    assert.match(src, /visits/);
  });
});

describe('dashboard UI wiring', () => {
  test('Customers nav link exists', () => {
    // Stitch redesign moved the nav definitions into the DashboardChrome
    // shell component; the layout renders that shell.
    const layout = code(LAYOUT);
    assert.match(layout, /<DashboardChrome/);
    const chrome = readFileSync(LAYOUT.replace('layout.tsx', 'dashboard-chrome.tsx'), 'utf8');
    assert.match(chrome, /href:\s*'\/dashboard\/customers'/);
    assert.match(chrome, /label:\s*'Customers'/);
  });

  test('list page is tenant-scoped', () => {
    const src = code(LIST_PAGE);
    assert.match(src, /getOrCreateTenant/);
    assert.match(src, /listProfiles\(tenant\.id/);
  });

  test('detail page loads visit history and preferences', () => {
    const src = code(DETAIL_PAGE);
    assert.match(src, /getProfile\(tenant\.id/);
    assert.match(src, /listVisitHistory/);
    assert.match(src, /preferences/);
  });
});
