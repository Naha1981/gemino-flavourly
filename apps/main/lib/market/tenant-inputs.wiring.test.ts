import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PAGE = join(HERE, '..', '..', 'app', 'dashboard', 'settings', 'page.tsx');
const SETTINGS_API = join(HERE, '..', '..', 'app', 'api', 'settings', 'route.ts');
const MENU_PAGE = join(HERE, '..', '..', 'app', 'm', '[slug]', 'page.tsx');

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Gates #15 and #18 both need data only the OWNER can supply: where the venue
 * is (the 5km discovery radius is measured from it) and what it serves
 * (positioning and opportunity analysis compare it against competitors).
 * These tests pin that path end to end — form -> API -> public menu page —
 * because a column nobody can fill in is a feature that never runs.
 */
describe('tenant inputs for the market engine', () => {
  test('the settings form collects and round-trips the address and the menu', () => {
    const page = code(SETTINGS_PAGE);
    assert.match(page, /address:\s*''/);
    assert.match(page, /menuText:\s*''/);
    assert.match(page, /address:\s*data\.tenant\.address \|\| ''/);
    assert.match(page, /menuText:\s*data\.tenant\.menuText \|\| ''/);
    assert.match(page, /formData\.address/);
    assert.match(page, /formData\.menuText/);
    // The save posts the whole form, so both fields travel with it.
    assert.match(page, /JSON\.stringify\(formData\)/);
  });

  test('the settings API persists both fields without clobbering the rest', () => {
    const route = code(SETTINGS_API);
    assert.match(route, /address, menuText \}\s*=\s*body/);
    assert.match(route, /address:\s*address !== undefined \? address : tenant\.address/);
    assert.match(route, /menuText:\s*menuText !== undefined \? menuText : tenant\.menuText/);
    // Still tenant-scoped, as before.
    assert.match(route, /eq\(tenants\.id,\s*tenant\.id\)/);
  });

  test('the public menu page renders the published menu and falls back when empty', () => {
    const page = code(MENU_PAGE);
    assert.match(page, /menuText:\s*true/, 'the cached query must select menu_text');
    assert.match(page, /tenant\.menuText \?/);
    assert.match(page, /whitespace-pre-wrap/);
    assert.match(page, /Message us on WhatsApp/, 'the fallback copy must survive');
  });
});
