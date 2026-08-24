import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const STORE = join(HERE, 'segmentation-store.ts');
const LOGIC = join(HERE, 'segmentation.ts');
const RUNNER = join(HERE, 'segmentation-cron.ts');
const CRON = join(APP, 'api', 'cron', 'customer-segmentation', 'route.ts');
const LIST_API = join(APP, 'api', 'customer', 'profiles', 'route.ts');
const COUNTS_API = join(APP, 'api', 'customer', 'profiles', 'segment-counts', 'route.ts');
const LIST_PAGE = join(APP, 'dashboard', 'customers', 'page.tsx');
const ADMIN_PAGE = join(APP, 'admin', 'page.tsx');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0006_customer_segmentation.sql');
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

describe('customer segmentation schema wiring', () => {
  test('schema has segment fields and a segment index', () => {
    const src = code(SCHEMA);
    assert.match(src, /segment:\s*text\('segment'/);
    assert.match(src, /segmentConfidence:\s*numeric\('segment_confidence'\)/);
    assert.match(src, /segmentUpdatedAt:\s*timestamp\('segment_updated_at'\)/);
    assert.match(src, /index\('customer_profiles_segment_idx'\)\.on\(table\.segment\)/);
  });

  test('0006 migration adds all fields and the index', () => {
    const src = source(MIGRATION);
    assert.match(src, /ADD COLUMN IF NOT EXISTS "segment" text DEFAULT 'new'/);
    assert.match(src, /ADD COLUMN IF NOT EXISTS "segment_confidence" numeric DEFAULT 0/);
    assert.match(src, /ADD COLUMN IF NOT EXISTS "segment_updated_at" timestamp/);
    assert.match(src, /customer_profiles_segment_idx/);
  });

  test('migration journal and /api/migrate include Gate #8 DDL', () => {
    const journal = JSON.parse(source(JOURNAL));
    assert.ok(journal.entries.some((entry: { tag: string }) => entry.tag === '0006_customer_segmentation'));
    const route = code(MIGRATE_ROUTE);
    assert.match(route, /ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS segment/);
    assert.match(route, /segment_confidence numeric DEFAULT 0/);
    assert.match(route, /customer_profiles_segment_idx/);
  });
});

describe('customer segmentation seams', () => {
  test('segmentation rules are framework-free', () => {
    const src = code(LOGIC);
    assert.doesNotMatch(src, /from\s+['"](?:@\/lib\/db|drizzle-orm|next\/)/);
  });

  test('store fetches are tenant-scoped', () => {
    const src = code(STORE);
    assert.match(from(src, 'export async function fetchProfilesForSegmentation'), /eq\(customerProfiles\.tenantId,\s*tenantId\)/);
    assert.match(from(src, 'export async function countBySegment'), /groupedSegmentCounts\(tenantId\)/);
  });

  test('segment mutations are conditional and stamp confidence plus update time', () => {
    const body = from(code(STORE), 'export async function updateSegment');
    assert.match(body, /eq\(customerProfiles\.id,\s*profileId\)/);
    assert.match(body, /ne\(customerProfiles\.segment,\s*segment\)/);
    assert.match(body, /segmentConfidence/);
    assert.match(body, /segmentUpdatedAt/);
  });

  test('platform aggregation is separate from tenant aggregation', () => {
    const src = code(STORE);
    assert.match(src, /export async function fetchCrossTenantSegmentCounts/);
    assert.match(src, /return groupedSegmentCounts\(\);/);
  });

  test('cron runner preserves tenant boundaries and calls the mutation seam', () => {
    const src = code(RUNNER);
    assert.match(src, /findTenantIds/);
    assert.match(src, /fetchProfilesForSegmentation\(tenantId\)/);
    assert.match(src, /updateSegment\(profile\.id,\s*result\.segment,\s*result\.confidence\)/);
  });
});

describe('customer segmentation route and dashboard wiring', () => {
  test('cron uses bearer auth before the database-backed runner', () => {
    const src = code(CRON);
    const guardAt = src.indexOf('assertCronAuthorized(req)');
    const dbAt = src.indexOf('db.select');
    assert.match(src, /import\s*\{[^}]*assertCronAuthorized[^}]*\}\s*from\s*'@\/lib\/cron\/auth'/);
    assert.ok(guardAt > -1 && dbAt > -1 && guardAt < dbAt);
    assert.match(src, /runCustomerSegmentationCron/);
  });

  test('profile API validates and passes the segment filter', () => {
    const src = code(LIST_API);
    assert.match(src, /normalizeCustomerSegment/);
    assert.match(src, /listProfiles\(tenant\.id,\s*limit,\s*offset,\s*segment\)/);
    assert.match(src, /countProfiles\(tenant\.id,\s*segment\)/);
    assert.match(src, /serializeCustomerProfile/);
  });

  test('segment-counts API requires the signed-in tenant', () => {
    const src = code(COUNTS_API);
    assert.match(src, /getOrCreateTenant/);
    assert.match(src, /countBySegment\(tenant\.id\)/);
    assert.match(src, /status:\s*401/);
  });

  test('customer dashboard contains the requested filter, counts, and color classes', () => {
    const src = code(LIST_PAGE);
    for (const label of ['All segments', 'VIP only', 'Regular only', 'At-risk only', 'Dormant only', 'New only']) {
      assert.match(src, new RegExp(label));
    }
    for (const text of ['VIP:', 'Regular:', 'At-risk:', 'Dormant:', 'New:']) assert.match(src, new RegExp(text));
    assert.match(src, /bg-amber/);
    assert.match(src, /bg-blue/);
    assert.match(src, /bg-orange/);
    assert.match(src, /bg-zinc/);
    assert.match(src, /bg-emerald/);
    assert.match(src, /SegmentBadge/);
  });

  test('super admin includes the platform segmentation metric', () => {
    const src = code(ADMIN_PAGE);
    assert.match(src, /fetchCrossTenantSegmentCounts/);
    assert.match(src, /title="Platform Segmentation"/);
    assert.match(src, /platformSegmentCounts\.vip/);
    assert.match(src, /platformSegmentCounts\.at_risk/);
  });
});
