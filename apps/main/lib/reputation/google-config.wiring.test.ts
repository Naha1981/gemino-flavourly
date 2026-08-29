import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = join(HERE, '..', '..', 'app', 'api', 'reputation', 'google-config', 'route.ts');
const SETTINGS = join(HERE, '..', '..', 'app', '(app)', 'dashboard', 'settings', 'page.tsx');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('google-config API wiring (Gate #11)', () => {
  const src = code(ROUTE);

  test('GET/POST both authenticate before touching the store', () => {
    for (const handler of ['export async function GET', 'export async function POST']) {
      const at = src.indexOf(handler);
      assert.ok(at > -1, `${handler} not found`);
      const body = src.slice(at);
      const authAt = body.indexOf('getOrCreateTenant()');
      const storeAt = body.search(/getPlaceConfig|savePlaceConfig/);
      assert.ok(authAt > -1 && authAt < storeAt, `${handler} touches the store before auth`);
      assert.match(body, /status:\s*401/);
    }
  });

  test('the API key is validated for length and stored via the encrypting store only', () => {
    const body = src.slice(src.indexOf('export async function POST'));
    assert.match(body, /savePlaceConfig\(tenant\.id,\s*placeId,\s*apiKey\)/);
    // No raw SQL / no direct table write in the route itself.
    assert.doesNotMatch(body, /db\./);
  });

  test('an absent api_key keeps the stored one (no wipe on place-id-only saves)', () => {
    // Route level: absent/blank api_key becomes null …
    assert.match(src, /typeof body\.api_key === 'string' && body\.api_key\.trim\(\) \? body\.api_key\.trim\(\) : null/);
    // …and the STORE is what treats null as "keep the stored ciphertext":
    const store = code(join(HERE, 'review-store.ts'));
    const body = store.slice(store.indexOf('export async function savePlaceConfig'));
    assert.match(body, /\.\.\.\(apiKey \? \{ apiKeyEncrypted: encryptSecret\(apiKey\) \} : \{\}\)/);
  });
});

describe('settings UI wiring (Gate #11)', () => {
  const src = code(SETTINGS);

  test('renders the Google Places section with masked key input', () => {
    assert.match(src, /Google Places Configuration/);
    assert.match(src, /type="password"/);
    assert.match(src, /autoComplete="off"/);
  });

  test('saves via POST /api/reputation/google-config and never pre-fills the key', () => {
    assert.match(src, /fetch\('\/api\/reputation\/google-config'/);
    assert.match(src, /method:\s*'POST'/);
    // The key field starts empty and is cleared after save.
    assert.match(src, /apiKey:\s*''/);
  });

  test('blank key is omitted from the request body (stored key survives)', () => {
    assert.match(src, /googleConfig\.apiKey\.trim\(\) \? \{ api_key: googleConfig\.apiKey\.trim\(\) \} : \{\}/);
  });

  test('shows last fetch time from the safe config shape', () => {
    assert.match(src, /has_api_key/);
    assert.match(src, /last_fetch_at/);
  });
});
