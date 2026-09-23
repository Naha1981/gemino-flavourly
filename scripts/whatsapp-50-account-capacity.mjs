#!/usr/bin/env node
/**
 * Application-layer 50-account capacity gate.
 *
 * This deliberately exercises Gemino's central-Operator HTTP contract with 50
 * logical tenant/account pairs at once. It does NOT open 50 real WhatsApp
 * sockets and must never be presented as a Baileys/socket capacity test.
 *
 * Usage:
 *   node scripts/whatsapp-50-account-capacity.mjs
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';

const PORT = Number(process.env.CAPACITY_OPERATOR_PORT ?? 3301);
const BASE = `http://127.0.0.1:${PORT}`;
const API_KEY = process.env.CAPACITY_OPERATOR_API_KEY ?? 'capacity-ci-key';
const APP_ID = 'gemino';
const ACCOUNT_COUNT = 50;

function headers(tenantId) {
  return {
    'content-type': 'application/json',
    'x-api-key': API_KEY,
    'x-app-id': APP_ID,
    'x-tenant-id': tenantId,
  };
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { response, body };
}

async function waitForHealth(deadlineMs = Date.now() + 10_000) {
  while (Date.now() < deadlineMs) {
    try {
      const { response } = await jsonFetch('/health');
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Mock central Operator failed to become healthy');
}

const mock = spawn(process.execPath, ['tests/e2e/personas/mock-operator.mjs', String(PORT)], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
mock.stdout.on('data', (chunk) => process.stdout.write(`[operator] ${chunk}`));

try {
  await waitForHealth();

  const tenants = Array.from({ length: ACCOUNT_COUNT }, (_, index) => `capacity-tenant-${String(index + 1).padStart(2, '0')}`);
  const bootstraps = await Promise.all(tenants.map(async (tenantId) => {
    const { response, body } = await jsonFetch('/accounts/bootstrap', {
      method: 'POST',
      headers: headers(tenantId),
      body: JSON.stringify({ appId: APP_ID, tenantId }),
    });
    if (response.status !== 201 && response.status !== 200) throw new Error(`bootstrap ${tenantId}: HTTP ${response.status}`);
    if (!body?.waAccountId) throw new Error(`bootstrap ${tenantId}: missing waAccountId`);
    return { tenantId, accountId: body.waAccountId };
  }));

  const uniqueIds = new Set(bootstraps.map(({ accountId }) => accountId));
  if (uniqueIds.size !== ACCOUNT_COUNT) throw new Error(`expected ${ACCOUNT_COUNT} unique accounts, got ${uniqueIds.size}`);

  const operations = await Promise.all(bootstraps.map(async ({ tenantId, accountId }) => {
    const scope = headers(tenantId);
    const results = await Promise.all([
      jsonFetch(`/accounts/${encodeURIComponent(accountId)}/connect`, { method: 'POST', headers: scope }),
      jsonFetch(`/accounts/${encodeURIComponent(accountId)}/status`, { headers: scope }),
      jsonFetch(`/accounts/${encodeURIComponent(accountId)}/qr`, { headers: scope }),
      jsonFetch('/send', {
        method: 'POST',
        headers: scope,
        body: JSON.stringify({ waAccountId: accountId, type: 'text', to: `2782${tenantId.slice(-2)}00000`, text: `capacity-smoke ${tenantId}` }),
      }),
    ]);
    for (const [name, { response, body }] of [
      ['connect', results[0]],
      ['status', results[1]],
      ['qr', results[2]],
      ['send', results[3]],
    ]) {
      if (!response.ok) throw new Error(`${tenantId}/${name}: HTTP ${response.status}`);
      if (!body) throw new Error(`${tenantId}/${name}: empty response`);
    }
    return tenantId;
  }));

  if (operations.length !== ACCOUNT_COUNT) throw new Error(`only ${operations.length}/${ACCOUNT_COUNT} accounts completed`);

  // Cross-tenant boundary check: tenant A may not operate tenant B's account.
  const victim = bootstraps[1];
  const attacker = bootstraps[0];
  const { response: forbidden } = await jsonFetch(`/accounts/${encodeURIComponent(victim.accountId)}/status`, {
    headers: headers(attacker.tenantId),
  });
  if (forbidden.status !== 403) {
    throw new Error(`tenant isolation failed: expected HTTP 403, got ${forbidden.status}`);
  }

  const elapsedMs = Math.max(1, Date.now() - Number(process.env.CAPACITY_STARTED_AT ?? Date.now()));
  console.log(JSON.stringify({
    ok: true,
    accountCount: ACCOUNT_COUNT,
    uniqueAccounts: uniqueIds.size,
    concurrentOperationSets: operations.length,
    tenantIsolation403: true,
    elapsedMs,
    qualification: 'application-layer central Operator contract only; not real WhatsApp/Baileys socket capacity',
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  mock.kill('SIGTERM');
  await once(mock, 'close').catch(() => undefined);
}
