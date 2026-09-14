#!/usr/bin/env node
/**
 * GATE QA-2 — local mock for the central NahaLabs WhatsApp Operator.
 *
 * It implements the central account contract used by apps/main. QR strings
 * are intentionally raw pairing strings in mock mode so the dashboard's
 * existing qrcode.react canvas path can be decoded by the persona suite;
 * production returns the central Operator's data:image/png QR unchanged.
 *
 * Run: node tests/e2e/personas/mock-operator.mjs [port=3001]
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 3001);
let counter = 0;
const accounts = new Map();

function qrPayload() {
  counter += 1;
  const head = `2@${counter.toString(36).padStart(6, '0')}`;
  const mid = 'ABCDEFGHIJKLMNOPabcdefghijklmnop0123456789';
  let body = '';
  for (let i = 0; i < 20; i += 1) body += mid;
  const tail = `,${counter.toString(36).padStart(4, '0')}==`;
  return (head + body + tail).slice(0, 237);
}

function accountIdForTenant(tenantId) {
  const hex = createHash('sha256').update(tenantId).digest('hex').slice(0, 32);
  const normalized = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${['89ab'[parseInt(hex[16], 16) % 4], hex.slice(17, 20)].join('')}-${hex.slice(20, 32)}`;
  return normalized;
}

let currentQr = qrPayload();
const rotate = setInterval(() => { currentQr = qrPayload(); }, 20_000);

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function requireScope(req, body = {}) {
  return String(req.headers['x-api-key'] ?? '').trim()
    && String(req.headers['x-app-id'] ?? body.appId ?? '').trim()
    && String(req.headers['x-tenant-id'] ?? body.tenantId ?? '').trim();
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('OK');
    return;
  }

  if (!String(req.headers['x-api-key'] ?? '').trim()) {
    send(res, 401, { error: 'Unauthorized: missing X-API-Key header' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/accounts/bootstrap') {
    const body = await readJson(req);
    if (!body || !requireScope(req, body)) {
      send(res, 400, { error: 'appId and tenantId are required' });
      return;
    }
    const tenantId = String(req.headers['x-tenant-id'] ?? body.tenantId);
    let accountId = [...accounts.entries()].find(([, value]) => value.tenantId === tenantId)?.[0];
    const created = !accountId;
    if (!accountId) {
      accountId = accountIdForTenant(tenantId);
      accounts.set(accountId, { tenantId, connected: false, phoneNumber: null });
    }
    send(res, created ? 201 : 200, { waAccountId: accountId, status: accounts.get(accountId).connected ? 'connected' : 'connecting', appId: body.appId, tenantId, created, webhookConfigured: true });
    return;
  }

  const match = url.pathname.match(/^\/accounts\/([^/]+)(?:\/(.+))?$/);
  if (match) {
    const accountId = decodeURIComponent(match[1]);
    const operation = match[2] ?? '';
    const account = accounts.get(accountId);
    if (!account) {
      // Allow a freshly bootstrapped-looking id to be initialized for direct contract tests.
      send(res, 404, { error: 'NOT_FOUND', message: 'Account not found' });
      return;
    }
    const tenantId = String(req.headers['x-tenant-id'] ?? '');
    if (!tenantId || tenantId !== account.tenantId) {
      send(res, 403, { error: 'ACCOUNT_SCOPE_FORBIDDEN', message: 'The requested WhatsApp account is not bound to this tenant' });
      return;
    }

    if (req.method === 'POST' && operation === 'connect') {
      account.connected = false;
      account.qr = currentQr;
      send(res, 200, { waAccountId: accountId, status: 'connecting' });
      return;
    }
    if (req.method === 'GET' && operation === 'status') {
      send(res, 200, { waAccountId: accountId, status: account.connected ? 'connected' : 'connecting', isConnected: account.connected, phoneNumber: account.phoneNumber });
      return;
    }
    if (req.method === 'GET' && operation === 'qr') {
      send(res, 200, { status: account.connected ? 'connected' : 'qr_ready', isConnected: account.connected, qrCode: account.connected ? null : currentQr, qrGeneratedAt: new Date().toISOString(), qrExpiresAt: new Date(Date.now() + 20_000).toISOString(), qrPollIntervalMs: 3000 });
      return;
    }
    if (req.method === 'POST' && operation === 'pairing-code') {
      const body = await readJson(req);
      if (!body?.phoneNumber) {
        send(res, 400, { error: 'VALIDATION_ERROR', message: 'phoneNumber is required' });
        return;
      }
      account.pairingCode = 'MOCK-1234';
      account.pairingExpiresAt = Date.now() + 60_000;
      send(res, 200, { waAccountId: accountId, status: 'pairing_code_ready', pairingCode: 'MOCK-1234', pairingCodeDisplay: 'MOCK-1234', expiresAt: new Date(account.pairingExpiresAt).toISOString(), isConnected: false });
      return;
    }
    if (req.method === 'GET' && operation === 'pairing-code') {
      const active = account.pairingCode && account.pairingExpiresAt > Date.now();
      send(res, 200, { waAccountId: accountId, status: active ? 'pairing_code_ready' : (account.connected ? 'connected' : 'connecting'), pairingCode: active ? account.pairingCode : null, pairingCodeDisplay: active ? account.pairingCode : null, expiresAt: active ? new Date(account.pairingExpiresAt).toISOString() : null, isConnected: account.connected });
      return;
    }
    if (req.method === 'POST' && operation === 'reset') {
      account.connected = false;
      account.phoneNumber = null;
      account.pairingCode = null;
      send(res, 200, { waAccountId: accountId, status: 'pending' });
      return;
    }
    if (req.method === 'POST' && operation === 'disconnect') {
      account.connected = false;
      account.phoneNumber = null;
      send(res, 200, { waAccountId: accountId, status: 'logged_out' });
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/send') {
    const body = await readJson(req);
    const account = accounts.get(String(body?.waAccountId ?? ''));
    if (!body || !account) return send(res, 404, { error: 'NOT_FOUND', message: 'Account not found' });
    if (!requireScope(req, body) || String(req.headers['x-tenant-id']) !== account.tenantId) {
      return send(res, 403, { error: 'ACCOUNT_SCOPE_FORBIDDEN', message: 'Account scope mismatch' });
    }
    return send(res, 200, { ok: true, type: body.type ?? 'text', message: { key: { id: `mock-message-${Date.now()}` } } });
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-operator] central contract listening on http://127.0.0.1:${port} (QR rotates every 20s)`);
});

process.on('SIGTERM', () => { clearInterval(rotate); server.close(); });
