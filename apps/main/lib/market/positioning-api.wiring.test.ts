import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = join(HERE, '..', '..', 'app', 'api', 'market', 'positioning', 'route.ts');
const PAGE = join(HERE, '..', '..', 'app', 'dashboard', 'market', 'positioning', 'page.tsx');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('positioning API + UI wiring (Gate #18)', () => {
  test('files exist', () => {
    assert.ok(existsSync(API), 'missing positioning route');
    assert.ok(existsSync(PAGE), 'missing positioning page');
  });

  test('API composes tenant rating (Engine 3) + menus (Gate #16 snapshots)', () => {
    const src = code(API);
    assert.match(src, /getOrCreateTenant\(\)/);
    assert.match(src, /status:\s*401/);
    assert.match(src, /getAverageRating\(tenant\.id\)/);
    assert.match(src, /getSelfCompetitor\(tenant\.id\)/);
    assert.match(src, /listCompetitors\(tenant\.id\)/);
    assert.match(src, /buildPositioningReport\(/);
  });

  test('competitor reads are tenant-scoped (no cross-tenant leakage)', () => {
    const src = code(API);
    assert.doesNotMatch(src, /listCompetitors\((?!tenant\.id)/);
    assert.match(src, /getAverageRating\(tenant\.id\)/);
  });

  test('API surfaces a hint when the tenant menu is untracked', () => {
    assert.match(code(API), /tenant_menu_tracked/);
    assert.match(code(API), /Discover Competitors/);
  });

  test('UI renders all four gate sections', () => {
    const src = code(PAGE);
    for (const section of ['Price positioning', 'Rating ranking', 'Menu overlap analysis', 'unique offerings']) {
      assert.ok(src.includes(section), `page missing section: ${section}`);
    }
    assert.match(src, /buildPositioningReport\(/);
  });
});
