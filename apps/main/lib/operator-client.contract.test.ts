import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * CONTRACT TEST — the Core→Operator /status seam (the QR live-merge defect).
 *
 * Production defect (Phase 2 gate, 2026-09-02): the operator's /status route
 * has been fail-closed since PR #44 — it answers 400 unless BOTH `waAccountId`
 * and `tenantId` are present, and 403 unless the account belongs to that
 * tenant. `operatorClient.getStatus()` only ever sent `waAccountId`. Every
 * live-snapshot call from /api/whatsapp/status therefore returned null in
 * production, so the QA-2 "merge the operator's live linking snapshot" logic
 * never executed: the linking page fell back to the core DB row, whose
 * `qr_code` column is NEVER written — the QR appeared from the /connect kick
 * and vanished on the next 3-second poll.
 *
 * Three layers, deliberately:
 *
 *   1. SOURCE-SCAN pins on operator/src/routes/status.ts — the contract's
 *      source of truth. The operator cannot be imported at runtime here (it
 *      is a standalone Express service with its own Postgres pool, deployed
 *      to Render), so this layer is what makes drift impossible to miss: if
 *      the operator's contract changes, these pins fail BEFORE the
 *      behavioural layer can silently test an outdated copy.
 *   2. BEHAVIOURAL: a local HTTP server on an ephemeral port implementing
 *      exactly the pinned contract (same 400/403 strings, same 200 shape),
 *      and the real `operatorClient` pointed at it. This is the red→green
 *      pair for the one-line fix.
 *   3. SOURCE-SCAN pins on the Core side (client + route) so the parameter
 *      cannot silently disappear again.
 *
 * The operator's own 69-test suite (operator/test/) pins the real handler
 * end-to-end; this file pins the Core's half of the seam and the contract
 * text both sides share.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

// Fixtures: WAACC_A belongs to TENANT_A (mirrors the operator's
// wa_accounts.tenant_id ownership column).
const TENANT_A = 'tenant_contract_a';
const TENANT_B = 'tenant_contract_b';
const WAACC_A = 'waacc_contract_a';
const LIVE_QR =
  '2@contractfixturepairingpayloadXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const ACCOUNT_OWNERS: Record<string, string> = { [WAACC_A]: TENANT_A };

// ---------------------------------------------------------------------------
// Layer 2 — the contract server (mirrors operator/src/routes/status.ts)
// ---------------------------------------------------------------------------
const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'GET' || url.pathname !== '/status') {
    return send(404, { error: 'Not found' });
  }

  const waAccountId = url.searchParams.get('waAccountId');
  const tenantId = url.searchParams.get('tenantId');

  // EXACT mirrors of operator/src/routes/status.ts (pinned by layer 1 —
  // the strings must stay byte-identical to the operator's, which is the
  // point: the contract is shared, not re-invented).
  if (!waAccountId || !tenantId) {
    return send(400, { error: 'waAccountId and tenantId are required' });
  }
  if (ACCOUNT_OWNERS[waAccountId] !== tenantId) {
    return send(403, { error: 'waAccountId does not belong to the given tenantId' });
  }

  return send(200, {
    isConnected: false,
    phoneNumber: null,
    qrCode: LIVE_QR,
    status: 'connecting',
    inMemoryActive: true,
    lastConnectedAt: null,
  });
});

// The client reads OPERATOR_URL at module load, and the test file cannot use
// top-level await (apps/main's tsconfig has no target → ES5 default). The
// boot + dynamic import therefore live in the file-level before() hook: the
// contract server starts, the env points at it, and ONLY THEN is the client
// imported (node --test runs each file in its own process, so this cannot
// leak into other test files).
type OperatorClientModule = typeof import('./operator-client');
let client: OperatorClientModule | null = null;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  process.env.OPERATOR_URL = `http://127.0.0.1:${port}`;
  process.env.OPERATOR_API_KEY = 'contract-test-key';
  client = await import('./operator-client.ts');
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

// ---------------------------------------------------------------------------
// Layer 1 — the operator's side of the contract (source of truth)
// ---------------------------------------------------------------------------
describe('operator /status contract — source of truth (operator/src/routes/status.ts)', () => {
  const operatorStatusSrc = readFileSync(
    join(HERE, '..', '..', '..', 'operator', 'src', 'routes', 'status.ts'),
    'utf8'
  );

  test('the operator REQUIRES both waAccountId and tenantId (fail-closed since PR #44)', () => {
    assert.match(
      operatorStatusSrc,
      /if \(!waAccountId \|\| !tenantId\)/,
      'the operator must refuse parameter-incomplete /status calls with 400 — an optional tenantId check is fail-open'
    );
    assert.match(
      operatorStatusSrc,
      /waAccountId and tenantId are required/,
      'the 400 error string is shared contract text — keep it byte-identical'
    );
  });

  test('the operator verifies tenant ownership (403 on mismatch)', () => {
    assert.match(
      operatorStatusSrc,
      /account\.tenant_id !== tenantId/,
      'one tenant must not be able to read another tenant connection status by guessing an ID'
    );
    assert.match(operatorStatusSrc, /does not belong to the given tenantId/);
  });

  test('the operator returns the live linking snapshot on success', () => {
    // The fields the Core's live QR merge consumes.
    assert.match(operatorStatusSrc, /qrCode:\s*account\.qr_code/);
    assert.match(operatorStatusSrc, /isConnected:\s*account\.is_connected/);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — behavioural: the real client against the pinned contract
// ---------------------------------------------------------------------------
describe('operatorClient.getStatus() satisfies the /status contract (red→green for the QR-merge defect)', () => {
  test('sends BOTH ids: the operator answers with the live snapshot (200)', async () => {
    const snap = await client!.operatorClient.getStatus(TENANT_A, WAACC_A);

    assert.ok(
      snap,
      [
        'getStatus returned null — the operator REFUSED the call.',
        'The /status contract (operator/src/routes/status.ts) requires BOTH waAccountId and',
        'tenantId; a missing tenantId is a 400. Null here means the live QR merge in',
        '/api/whatsapp/status never executes in production: the page falls back to the core',
        'DB row, whose qr_code column is never written, so the QR vanishes ~3s after every',
        '/connect kick. This is the production defect this branch fixes.',
      ].join(' ')
    );

    assert.equal(snap.isConnected, false);
    assert.equal(snap.status, 'connecting');
    assert.equal(snap.qrCode, LIVE_QR);
    assert.equal(snap.phoneNumber, null);
  });

  test('fail-closed: a foreign tenantId is refused (403) and surfaces as null', async () => {
    const snap = await client!.operatorClient.getStatus(TENANT_B, WAACC_A);

    assert.equal(
      snap,
      null,
      'the operator refuses cross-tenant reads with 403 — getStatus must not paper over it'
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — the Core's side of the contract (source pins)
// ---------------------------------------------------------------------------
describe('the Core side of the /status contract (source pins)', () => {
  const clientSrc = readFileSync(join(HERE, 'operator-client.ts'), 'utf8');
  const statusRouteSrc = readFileSync(
    join(HERE, '..', 'app', 'api', 'whatsapp', 'status', 'route.ts'),
    'utf8'
  );

  test('the client serialises tenantId into the /status query string', () => {
    assert.match(clientSrc, /\/status\?/, 'the client must call the operator /status route');
    assert.match(
      clientSrc,
      /tenantId=\$\{encodeURIComponent\(tenantId\)\}/,
      'tenantId must travel in the query string, URL-encoded — omitting it is the production 400'
    );
    assert.match(
      clientSrc,
      /waAccountId=\$\{encodeURIComponent\(waAccountId\)\}/,
      'waAccountId must stay in the query string, URL-encoded'
    );
  });

  test('the status route passes BOTH ids (tenant first — same order as sendMessage)', () => {
    assert.match(
      statusRouteSrc,
      /operatorClient\.getStatus\(tenant\.id,\s*account\.id\)/,
      'the live-snapshot call must pass the caller tenant id — account.id alone gets the call 400-rejected'
    );
  });
});
