import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * Wiring test: the QR-linking API routes must provision the tenant's
 * wa_accounts row via ensureWaAccount.
 *
 * Directly unit-testing the routes needs a full Clerk + Neon harness;
 * the production defect this locks in (2026-08-31) is structural —
 * tenants created before the row-per-tenant invariant existed 404'd out
 * of the linking flow — so source inspection is the right tool: it
 * fails the suite if either route regresses to a bare
 * `select().from(waAccounts)` without the provisioning path.
 *
 * Round 2 (2026-08-31 evening) adds contracts for the "Starting the
 * WhatsApp engine…" forever freeze: the status route must report
 * operator reachability while linking; the connect route must fail
 * LOUD on an unset OPERATOR_URL, pass the operator's own error through,
 * name the host on network failure, and return the operator's QR
 * snapshot; the page must surface failing status polls, keep kicks
 * firing on a failed poll, and NOT wipe engine errors on every routine
 * status poll.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(HERE, '..', '..', 'app', 'api', 'whatsapp');
const PAGE = join(HERE, '..', '..', 'app', '(app)', 'dashboard', 'whatsapp', 'page.tsx');

const statusRoute = readFileSync(join(ROUTES, 'status', 'route.ts'), 'utf8');
const connectRoute = readFileSync(join(ROUTES, 'connect', 'route.ts'), 'utf8');
const page = readFileSync(PAGE, 'utf8');

describe('whatsapp linking routes — wa_accounts provisioning wiring', () => {
  test('/api/whatsapp/status provisions the row (no 404 for legacy tenants)', () => {
    assert.match(statusRoute, /ensureWaAccount/);
    // The old defect: a bare select that 404'd when the row was absent.
    assert.doesNotMatch(statusRoute, /No WhatsApp account found/);
  });

  test('/api/whatsapp/connect provisions the row before calling the operator', () => {
    assert.match(connectRoute, /ensureWaAccount/);
    // The kick must target the provisioned account, not a separately
    // re-selected row.
    assert.match(connectRoute, /waAccountId:\s*account\.id/);
    assert.doesNotMatch(connectRoute, /No WhatsApp account found/);
  });
});

describe('whatsapp linking — round 2 diagnosability wiring (2026-08-31 evening)', () => {
  test('status route reports operator reachability while linking (cached, not always)', () => {
    assert.match(statusRoute, /operatorOnline/);
    // The health check is bounded so a Render cold start cannot hang the
    // status poll (see operator-client.checkHealth).
    assert.match(statusRoute, /checkOperatorOnline/);
    // Only while linking: no QR on the row AND not connected.
    assert.match(statusRoute, /!account\.isConnected && !account\.qrCode/);
  });

  test('connect route fails LOUD when OPERATOR_URL is unset (no fetch("undefined/…"))', () => {
    assert.match(connectRoute, /OPERATOR_URL is not configured/);
    // The guard must run BEFORE the fetch.
    const guardIdx = connectRoute.indexOf('OPERATOR_URL is not configured');
    const fetchIdx = connectRoute.indexOf('await fetch(');
    assert.ok(guardIdx >= 0 && fetchIdx >= 0 && guardIdx < fetchIdx, 'guard must precede the fetch');
  });

  test('connect route passes the operator error through instead of flattening it', () => {
    // The operator's own message (e.g. "Unauthorized: invalid x-api-key
    // header") must reach the browser — the single most useful string in
    // the chain.
    assert.match(connectRoute, /data\?\.error|typeof data\?\.error === 'string'/);
    assert.doesNotMatch(connectRoute, /error: data\?\.error \|\| 'WhatsApp engine unreachable\.'/);
  });

  test('connect route names the operator host on network failure (self-diagnosing URL)', () => {
    assert.match(connectRoute, /operatorHost\(\)/);
    assert.match(connectRoute, /unreachable \(host: /);
  });

  test('connect route returns the operator QR snapshot for immediate render', () => {
    assert.match(connectRoute, /qrCode:/);
    assert.match(connectRoute, /isConnected:/);
  });

  test('connect route bounds the fetch (Render cold start cannot eat maxDuration)', () => {
    assert.match(connectRoute, /AbortSignal\.timeout/);
  });

  test('page surfaces a FAILING status poll (no more silent infinite spinner)', () => {
    // The round-2 freeze: non-OK responses were swallowed whole.
    assert.match(page, /statusError/);
    assert.match(page, /Couldn't read WhatsApp status/);
  });

  test('page keeps kicking when the status poll fails (pollAttempted gate)', () => {
    assert.match(page, /pollAttempted/);
    assert.match(page, /shouldAutoKick\(\{/);
    // The old dead zone: the effect returned early when status was null.
    assert.doesNotMatch(page, /if \(!status\) return;/);
  });

  test('page does NOT clear engine errors on routine status polls', () => {
    // The offending line was `setError(null)` inside refresh()'s ok
    // branch. Errors may only be cleared by the TTL policy or a
    // successful kick / state improvement.
    const refreshBody = page.slice(page.indexOf('const refresh = useCallback'), page.indexOf('const kick = useCallback'));
    assert.doesNotMatch(refreshBody, /setError\(null\)/);
    assert.match(page, /shouldClearEngineError\(/);
  });

  test('page renders the engine-offline and logged-out states distinctly', () => {
    assert.match(page, /engine-offline/);
    assert.match(page, /logged-out/);
  });

  test('page renders the kick error persistently (testid contract)', () => {
    assert.match(page, /engine-error/);
  });
});

describe('whatsapp linking — operator /status contract wiring (2026-09-03, QR live-merge fix)', () => {
  test('status route passes BOTH ids to getStatus — tenant first, account second', () => {
    // The operator's /status is fail-closed (PR #44): 400 unless BOTH
    // waAccountId and tenantId are present. A bare account.id call is
    // silently 400-rejected → null snapshot → the QR vanishes ~3s after
    // every /connect kick (the defect this branch fixes). The parameter
    // order is pinned too: getStatus mirrors sendMessage's (tenant, account).
    assert.match(statusRoute, /operatorClient\.getStatus\(\s*tenant\.id,\s*account\.id\s*\)/);
  });

  test('status route does not regress to the single-id getStatus call', () => {
    // The pre-fix fingerprint: account.id alone as the first (or only)
    // argument. Any of these shapes means tenantId stopped travelling.
    assert.doesNotMatch(statusRoute, /operatorClient\.getStatus\(\s*account\.id\s*[,)]/);
  });
});
