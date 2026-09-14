import { test, describe } from 'node:test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(HERE, '..', '..', 'app', 'api', 'whatsapp');
const PAGE = join(HERE, '..', '..', 'app', '(app)', 'dashboard', 'whatsapp', 'page.tsx');
const CLIENT = readFileSync(join(HERE, '..', 'operator-client.ts'), 'utf8');
const CENTRAL = readFileSync(join(HERE, 'central-operator.ts'), 'utf8');
const statusRoute = readFileSync(join(ROUTES, 'status', 'route.ts'), 'utf8');
const connectRoute = readFileSync(join(ROUTES, 'connect', 'route.ts'), 'utf8');
const page = readFileSync(PAGE, 'utf8');

describe('whatsapp linking routes — wa_accounts provisioning wiring', () => {
  test('/api/whatsapp/status provisions the row and uses central Operator status', () => {
    assert.match(statusRoute, /ensureWaAccount/);
    assert.match(statusRoute, /operatorClient\.getStatus\(\s*tenant\.id,\s*account\.id,\s*8_000\s*\)/);
    assert.doesNotMatch(statusRoute, /No WhatsApp account found/);
  });

  test('/api/whatsapp/connect provisions the row before calling the central facade', () => {
    assert.match(connectRoute, /ensureWaAccount/);
    assert.match(connectRoute, /operatorClient\.connect\(tenant\.id,\s*account\.id\)/);
    assert.match(connectRoute, /status:\s*202/);
    assert.match(connectRoute, /waking: true/);
    assert.doesNotMatch(connectRoute, /No WhatsApp account found/);
  });
});

describe('whatsapp linking — central Operator diagnosability', () => {
  test('central transport refuses production without OPERATOR_URL and authenticates server-side', () => {
    assert.match(CENTRAL, /OPERATOR_URL/);
    assert.match(CENTRAL, /process\.env\.OPERATOR_API_KEY/);
    assert.match(CENTRAL, /X-API-Key/);
    assert.match(CENTRAL, /X-App-Id/);
    assert.match(CENTRAL, /X-Tenant-Id/);
  });

  test('connect route exposes central Operator errors instead of flattening them', () => {
    assert.match(connectRoute, /result\.error/);
    assert.match(connectRoute, /error: result\.error/);
  });

  test('connect route models Render cold start as a transient waking state', () => {
    assert.match(CLIENT, /state: 'waking'/);
    assert.match(CLIENT, /transient: true/);
    assert.match(connectRoute, /retryAfterMs: 5_000/);
  });

  test('connect/status are bounded against a sleeping central service', () => {
    assert.match(CLIENT, /checkHealth\(5_000\)/);
    assert.match(statusRoute, /getStatus\([^)]*8_000\)/);
  });

  test('page surfaces a failing status poll and keeps auto-kicks active', () => {
    assert.match(page, /statusError/);
    assert.match(page, /Couldn't read WhatsApp status/);
    assert.match(page, /pollAttempted/);
    assert.match(page, /shouldAutoKick\(\{/);
    assert.doesNotMatch(page, /if \(!status\) return;/);
  });

  test('page does not wipe operator errors during ordinary status refresh', () => {
    const refreshStart = page.indexOf('const refresh = useCallback');
    const kickStart = page.indexOf('const kick = useCallback');
    assert.ok(refreshStart >= 0 && kickStart > refreshStart);
    const refreshBody = page.slice(refreshStart, kickStart);
    assert.doesNotMatch(refreshBody, /setError\(null\)/);
    assert.match(page, /shouldClearEngineError\(/);
  });

  test('page renders central Operator waking, offline and logged-out states distinctly', () => {
    assert.match(page, /data-testid="operator-waking"/);
    assert.match(page, /engine-offline/);
    assert.match(page, /logged-out/);
  });

  test('QR response remains nullable and pairing code is central-Operator supplied', () => {
    assert.match(CLIENT, /qrCode\?: string \| null/);
    assert.match(CENTRAL, /pairing-code/);
  });
});
