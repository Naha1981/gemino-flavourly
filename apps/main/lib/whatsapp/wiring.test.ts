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
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(HERE, '..', '..', 'app', 'api', 'whatsapp');

const statusRoute = readFileSync(join(ROUTES, 'status', 'route.ts'), 'utf8');
const connectRoute = readFileSync(join(ROUTES, 'connect', 'route.ts'), 'utf8');

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
