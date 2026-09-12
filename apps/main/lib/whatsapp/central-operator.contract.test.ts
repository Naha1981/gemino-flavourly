import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN_ROOT = join(HERE, '..');
const CENTRAL_CLIENT = readFileSync(join(HERE, 'whatsapp', 'central-operator.ts'), 'utf8');
const OPERATOR_CLIENT = readFileSync(join(HERE, 'operator-client.ts'), 'utf8');
const CONNECT_ROUTE = readFileSync(join(HERE, '..', 'app', 'api', 'whatsapp', 'connect', 'route.ts'), 'utf8');
const DASHBOARD = readFileSync(join(HERE, '..', 'app', '(app)', 'dashboard', 'whatsapp', 'page.tsx'), 'utf8');

function allSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return allSourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('central NahaLabs WhatsApp Operator contract', () => {
  test('server-side client uses the approved Operator host and required scope headers', () => {
    assert.match(CENTRAL_CLIENT, /my-own-whatsapp-2z5h\.onrender\.com/);
    assert.match(CENTRAL_CLIENT, /X-API-Key/);
    assert.match(CENTRAL_CLIENT, /X-App-Id/);
    assert.match(CENTRAL_CLIENT, /X-Tenant-Id/);
  });

  test('all documented account transport routes are represented', () => {
    for (const path of [
      '/accounts/bootstrap',
      '/accounts/${encodeURIComponent(centralId)}/connect',
      '/accounts/${encodeURIComponent(centralId)}/status',
      '/accounts/${encodeURIComponent(centralId)}/qr',
      '/accounts/${encodeURIComponent(centralId)}/pairing-code',
      '/accounts/${encodeURIComponent(centralId)}/reset',
      '/accounts/${encodeURIComponent(centralId)}/disconnect',
      "'/send'",
    ]) {
      assert.ok(CENTRAL_CLIENT.includes(path), `central transport is missing route ${path}`);
    }
  });

  test('the central account id is kept separate from Gemino local wa_accounts ids', () => {
    assert.match(CENTRAL_CLIENT, /waAccountBindings/);
    assert.match(CENTRAL_CLIENT, /resolveGeminoTenantFromCentralAccount/);
    assert.match(CENTRAL_CLIENT, /getLocalAccount\(tenantId, localWaAccountId\)/);
    assert.match(CENTRAL_CLIENT, /waAccountId: centralWaAccountId/);
  });

  test('outbound text uses the central /send contract', () => {
    assert.match(CENTRAL_CLIENT, /request<JsonRecord>\(tenantId, '\/send'/);
    assert.match(CENTRAL_CLIENT, /waAccountId: centralId/);
    assert.match(CENTRAL_CLIENT, /type: 'text'/);
  });

  test('Gemino transport code contains no Baileys or socket creation', () => {
    const files = allSourceFiles(MAIN_ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (text.includes('@whiskeysockets/baileys') || /\bmakeWASocket\s*\(/.test(text) || /new\s+WASocket/.test(text)) {
        offenders.push(relative(MAIN_ROOT, file));
      }
    }
    assert.deepEqual(offenders, [], `Gemino app still contains local Baileys/socket code: ${offenders.join(', ')}`);
  });

  test('legacy operator client is only a facade over the central transport', () => {
    assert.match(OPERATOR_CLIENT, /from '@\/lib\/whatsapp\/central-operator'/);
    assert.doesNotMatch(OPERATOR_CLIENT, /fetch\([^\n]+\/start/);
    assert.doesNotMatch(OPERATOR_CLIENT, /fetch\([^\n]+\/status/);
    assert.doesNotMatch(OPERATOR_CLIENT, /@whiskeysockets\/baileys/);
  });

  test('cold-start connect is modeled as a transient waking state, never a fake success', () => {
    assert.match(OPERATOR_CLIENT, /state: 'waking'/);
    assert.match(OPERATOR_CLIENT, /transient: true/);
    assert.match(CONNECT_ROUTE, /status: 202/);
    assert.match(CONNECT_ROUTE, /waking: true/);
    assert.match(CONNECT_ROUTE, /retryAfterMs: 5_000/);
  });

  test('dashboard visibly distinguishes waking from normal pairing', () => {
    assert.match(DASHBOARD, /const \[waking, setWaking\]/);
    assert.match(DASHBOARD, /data-testid="operator-waking"/);
    assert.match(DASHBOARD, /Waking the central WhatsApp Operator/);
  });
});
