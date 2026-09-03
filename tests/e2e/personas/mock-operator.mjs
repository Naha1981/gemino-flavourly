#!/usr/bin/env node
/**
 * GATE QA-2 — local WhatsApp-operator mock for the persona suite.
 *
 * Implements the operator HTTP contract (operator/src/routes) with a QR
 * string that ROTATES every 20 seconds, so the WhatsApp Connection page's
 * full linking lifecycle can be asserted without a real Baileys socket:
 *   GET  /health                 -> 200 OK (this is the keep-alive shape)
 *   POST /start    (x-api-key)   -> { success, qrCode, isConnected:false }
 *   GET  /status?waAccountId=..&tenantId=.. -> { isConnected:false, status:'connecting', qrCode }
 *
 * FAIL-CLOSED, exactly like the real operator (PR #44): /start and /status
 * both answer 400 unless BOTH waAccountId AND tenantId are present. The
 * old mock ignored tenantId on /status — which is precisely why the
 * production defect (operatorClient.getStatus() never sending tenantId,
 * every live-snapshot call 400-rejected on the real service) passed the
 * whole GATE_MOCK suite green: the mock was LOOSER than the contract it
 * was pretending to enforce. That escape hatch is closed: a Core-side
 * regression that drops a required parameter now fails in mock mode too.
 *
 * Honest limitation: this mock is stateless, so it checks parameter
 * PRESENCE only — the real operator's ownership check (403 when the
 * account belongs to another tenant) needs its Postgres. That side of
 * the contract is pinned by the operator's own test suite and mirrored
 * by apps/main/lib/operator-client.contract.test.ts.
 *
 * QR strings are 237 chars — the same length as a real Baileys pairing
 * payload — so the rendered canvas has realistic module density and jsQR
 * decode in the evidence harness is representative of a phone scan.
 *
 * Usage:  node tests/e2e/personas/mock-operator.mjs [port=3001]
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 3001);
let counter = 0;

function qrPayload() {
  counter += 1;
  const head = `2@${counter.toString(36).padStart(6, '0')}`;
  const mid = 'ABCDEFGHIJKLMNOPabcdefghijklmnop0123456789';
  let body = '';
  for (let i = 0; i < 20; i++) body += mid;
  const tail = `,${counter.toString(36).padStart(4, '0')}==`;
  return (head + body + tail).slice(0, 237);
}

let currentQr = qrPayload();
const rotate = setInterval(() => {
  currentQr = qrPayload();
}, 20_000);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('OK');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/start') {
    if (!req.headers['x-api-key']) return send(401, { error: 'Unauthorized: missing x-api-key header' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        // Mirror of operator/src/routes/start.ts: BOTH ids required.
        if (!parsed.waAccountId || !parsed.tenantId) {
          return send(400, { error: 'waAccountId and tenantId are required' });
        }
      } catch {
        return send(400, { error: 'Invalid JSON' });
      }
      send(200, { success: true, qrCode: currentQr, isConnected: false, phoneNumber: null });
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    // Mirror of operator/src/routes/status.ts: BOTH ids required (the
    // exact 400 string). The old mock ignored tenantId here — the
    // escape hatch that let the production defect sail through green.
    const waAccountId = url.searchParams.get('waAccountId');
    const tenantId = url.searchParams.get('tenantId');
    if (!waAccountId || !tenantId) {
      return send(400, { error: 'waAccountId and tenantId are required' });
    }
    send(200, { isConnected: false, status: 'connecting', qrCode: currentQr, phoneNumber: null });
    return;
  }

  send(404, { error: 'Not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-operator] listening on http://127.0.0.1:${port} (QR rotates every 20s)`);
});

process.on('SIGTERM', () => {
  clearInterval(rotate);
  server.close();
});
