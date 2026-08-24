import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = join(HERE, '..', '..', 'app', 'api', 'market', 'opportunities', 'route.ts');
const ID_ROUTE = join(HERE, '..', '..', 'app', 'api', 'market', 'opportunities', '[id]', 'route.ts');
const STORE = join(HERE, 'opportunity-store.ts');

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

describe('opportunities store (Gate #17)', () => {
  const src = code(STORE);

  test('saveOpportunities upserts on (tenant, key) so addressed survives', () => {
    const body = from(src, 'export async function saveOpportunities');
    assert.match(body, /onConflictDoUpdate\(/);
    assert.match(body, /target:\s*\[marketOpportunities\.tenantId,\s*marketOpportunities\.opportunityKey\]/);
    // the conflict update must NOT reset the tenant's flag:
    const setBlock = from(body, 'set: {').split('}')[0];
    assert.doesNotMatch(setBlock, /addressed/);
  });

  test('pruning only ever removes UNaddressed rows', () => {
    const src2 = from(src, 'export async function saveOpportunities');
    const pruneBlocks = src2.match(/\.delete\(marketOpportunities\)[\s\S]*?\.where\([\s\S]*?\);/g) ?? [];
    assert.ok(pruneBlocks.length >= 1);
    for (const block of pruneBlocks) {
      assert.match(block, /eq\(marketOpportunities\.addressed,\s*false\)/, 'a prune path can delete addressed rows');
    }
  });

  test('reads and mutations are tenant-scoped', () => {
    for (const fn of ['export async function getOpportunities', 'export async function markAddressed']) {
      assert.match(from(src, fn), /eq\(marketOpportunities\.tenantId,\s*tenantId\)/, `${fn} not tenant-scoped`);
    }
  });

  test('markAddressed is a one-way flip (false -> true only)', () => {
    const body = from(src, 'export async function markAddressed');
    assert.match(body, /addressed:\s*true/);
    assert.match(body, /eq\(marketOpportunities\.addressed,\s*false\)/);
  });

  test('platform metric is unscoped by design (super admin KPI)', () => {
    const body = from(src, 'export async function countAllOpportunities').split('\n\nexport ')[0];
    assert.doesNotMatch(body, /tenantId/);
  });
});

describe('opportunities API (Gate #17)', () => {
  test('GET runs the analyzer over tenant evidence and persists', () => {
    const src = code(ROUTE);
    assert.match(src, /getOrCreateTenant\(\)/);
    assert.match(src, /status:\s*401/);
    assert.match(src, /analyzeOpportunities\(evidence/);
    assert.match(src, /saveOpportunities\(tenant\.id/);
    assert.match(src, /listCompetitors\(tenant\.id\)/);
  });

  test('PATCH is tenant-scoped and one-way', () => {
    const src = code(ID_ROUTE);
    assert.match(src, /getOrCreateTenant\(\)/);
    assert.match(src, /markAddressed\(tenant\.id,\s*params\.id\)/);
    assert.match(src, /status:\s*401/);
    assert.match(src, /status:\s*404/);
  });
});
