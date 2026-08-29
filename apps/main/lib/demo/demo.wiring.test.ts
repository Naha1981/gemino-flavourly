import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, '..', '..');

function src(rel: string): string {
  const p = join(MAIN, rel);
  assert.ok(existsSync(p), `missing file: ${rel}`);
  return readFileSync(p, 'utf8');
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('demo mode — safety wiring', () => {
  test('seed + wipe routes exist and are super-admin gated (403)', () => {
    for (const rel of ['app/api/admin/seed-demo/route.ts', 'app/api/admin/wipe-demo/route.ts']) {
      const route = stripComments(src(rel));
      assert.match(route, /isSuperAdmin\(\)/, `${rel} must call isSuperAdmin`);
      assert.match(route, /status:\s*403/, `${rel} must reject non-admins with 403`);
    }
  });

  test('seed is wired to wipe-then-seed (idempotent)', () => {
    const store = stripComments(src('lib/demo/seed-store.ts'));
    assert.match(store, /await wipeDemoRows\(\)/);
    const seedIdx = store.indexOf('async function seedDemoData');
    const wipeIdx = store.indexOf('await wipeDemoRows()', seedIdx);
    assert.ok(wipeIdx > seedIdx, 'seedDemoData must wipe before inserting');
  });

  test('wipe deletes ONLY deadbeef-prefixed rows', () => {
    const store = stripComments(src('lib/demo/seed-store.ts'));
    // The wipe predicate is built from the deadbeef prefix constant.
    assert.match(store, /DEADBEEF_PREFIX/);
    assert.match(store, /\$\{DEADBEEF_PREFIX\}-%/);
    // Every delete is qualified with a where clause — no unqualified deletes.
    const deletes = store.match(/db\.delete\(/g) ?? [];
    const qualified = store.match(/db\.delete\(\w+\)\.where\(/g) ?? [];
    assert.ok(deletes.length > 0, 'wipe must delete');
    assert.equal(deletes.length, qualified.length, 'every delete must be qualified');
  });

  test('seed never runs automatically (no deploy/login hooks)', () => {
    const store = src('lib/demo/seed-store.ts');
    assert.doesNotMatch(store, /process\.env\.NODE_ENV.*seed/i);
    // Only the two admin routes import the seeder.
    assert.match(stripComments(src('app/api/admin/seed-demo/route.ts')), /seedDemoData/);
    assert.match(stripComments(src('app/api/admin/wipe-demo/route.ts')), /wipeDemoRows/);
  });

  test('demo tenant is The Grand Bistro with deadbeef id + owner link path', () => {
    const store = stripComments(src('lib/demo/seed-store.ts'));
    assert.match(store, /The Grand Bistro/);
    assert.match(store, /ownerUserId/);
    assert.match(store, /insert\(memberships\)/);
    assert.match(store, /naha\.thabiso@gmail\.com/);
  });

  test('admin page exposes Load/Wipe controls and the demo flag chip source', () => {
    const page = stripComments(src('app/(app)/admin/page.tsx'));
    assert.match(page, /<DemoControls/);
    assert.match(page, /demoSeedActive/);
    const layout = stripComments(src('app/(app)/dashboard/layout.tsx'));
    assert.match(layout, /demoSeedActive/);
    assert.match(layout, /demoActive/);
  });
});
