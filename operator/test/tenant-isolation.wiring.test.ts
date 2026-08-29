import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src', 'routes');

/**
 * Tenant-isolation wiring tests for the operator's /start and /status
 * routes.
 *
 * These routes had a tenant-ownership check added (PR #43) that mirrors
 * /send's — except the check was written as `if (tenantId) { ... }`
 * instead of requiring tenantId outright. That is a fail-OPEN check: any
 * caller holding the shared OPERATOR_API_KEY bypasses the isolation
 * entirely just by omitting tenantId from the request, which defeats the
 * point of adding it. /send already gets this right (tenantId is in the
 * required-fields 400 check, so the ownership comparison always runs).
 *
 * This is a source-wiring test, not a live-request test: getWaAccount()
 * hits a real Postgres pool with no dependency-injection seam, and this
 * repo has no DB-mocking convention for the operator (see config.test.ts's
 * own comment on why its tests take env as a plain parameter instead).
 * Asserting against the source proves the fail-closed shape without
 * needing a database.
 */
describe('operator tenant isolation is fail-closed, not fail-open', () => {
  const start = readFileSync(join(SRC, 'start.ts'), 'utf8');
  const status = readFileSync(join(SRC, 'status.ts'), 'utf8');
  const send = readFileSync(join(SRC, 'send.ts'), 'utf8');

  test('/send requires tenantId in its initial 400 check (reference pattern)', () => {
    assert.match(send, /if\s*\(\s*!tenantId\s*\|\|/);
  });

  test('/start requires tenantId in its initial 400 check', () => {
    assert.match(start, /if\s*\(\s*!waAccountId\s*\|\|\s*!tenantId\s*\)/);
  });

  test('/start does not gate the ownership check behind an optional `if (tenantId)`', () => {
    assert.doesNotMatch(start, /if\s*\(\s*tenantId\s*\)\s*{/);
  });

  test('/start always runs the ownership comparison (not conditionally skippable)', () => {
    // The 403 comparison must not be nested inside any `if (tenantId)`
    // block — it should be a plain top-level check now that tenantId is
    // required by the guard clause above it.
    const ownershipCheck = start.indexOf('account.tenant_id !== tenantId');
    const conditionalGate = start.indexOf('if (tenantId)');
    assert.ok(ownershipCheck !== -1, 'expected an ownership comparison');
    assert.equal(conditionalGate, -1, 'ownership check must not be behind an optional tenantId gate');
  });

  test('/status requires tenantId in its initial 400 check', () => {
    assert.match(status, /if\s*\(\s*!waAccountId\s*\|\|\s*!tenantId\s*\)/);
  });

  test('/status does not gate the ownership check behind an optional `if (tenantId)`', () => {
    assert.doesNotMatch(status, /if\s*\(\s*tenantId\s*&&/);
  });
});
