#!/usr/bin/env node
/**
 * GATE QA-2 — local WhatsApp-operator mock for the persona suite.
 *
 * Implements the operator HTTP contract (operator/src/routes) with a QR
 * string that ROTATES every 20 seconds, so the WhatsApp Connection page's
 * full linking lifecycle can be asserted without a real Baileys socket:
 *   GET  /health                 -> 200 OK (this is the keep-alive shape)
 *   POST /start    (x-api-key)   -> { success, qrCode, isConnected:false }
 *   GET  /status?waAccountId=..  -> { isConnected:false, status:'connecting', qrCode }
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
        if (!parsed.waAccountId) return send(400, { error: 'waAccountId required' });
      } catch {
        return send(400, { error: 'Invalid JSON' });
      }
      send(200, { success: true, qrCode: currentQr, isConnected: false, phoneNumber: null });
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
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
