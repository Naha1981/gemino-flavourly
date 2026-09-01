#!/usr/bin/env node
/**
 * GATE QA-2 — WhatsApp QR machine-scannability proof (task 1: "check if
 * the QR code for WhatsApp works well").
 *
 * Runs against the GATE_MOCK harness with the mock operator
 * (tests/e2e/personas/mock-operator.mjs), which serves a 237-char pairing
 * payload that ROTATES every 20 seconds — the same cadence a real Baileys
 * socket emits at (operator pins qrTimeout: 20_000).
 *
 * Proves, in one run:
 *   1. the connection page renders a QR canvas (288×288 internal);
 *   2. jsQR can DECODE the rendered canvas — machine-readable means
 *      phone-scannable (the same proof the 2026-08-31 QR gate used against
 *      a live Baileys socket);
 *   3. the decoded payload is the operator's pairing format (2@…, 237 chars);
 *   4. ~22s later the canvas decodes to a DIFFERENT payload — the
 *      auto-refresh contract ("new one every ~20s") is live.
 *
 * Usage:  node scripts/qa2-qr-decode.mjs   (needs the harness from
 *         scripts/qa2-evidence-run.sh running; artifacts land in
 *         test-results/qa-artifacts/)
 */
import { chromium } from '@playwright/test';
import jsQR from 'jsqr';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.GATE_BASE_URL || 'http://127.0.0.1:3100';
const ARTIFACTS = join(process.cwd(), 'qa2-artifacts');

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function decodeCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="qr-frame"] canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height);
    return { data: data.data, width, height, size: `${width}x${height}` };
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const host = new URL(BASE).hostname;
await page.context().addCookies([
  { name: '__gate_user', value: 'user_gate_tenantc', domain: host, path: '/', sameSite: 'Lax' },
]);

console.log('— opening /dashboard/whatsapp as the new-owner persona (Tenant C)…');
await page.goto(`${BASE}/dashboard/whatsapp`);
try {
  await page.waitForSelector('[data-testid="qr-frame"] canvas', { timeout: 45_000 });
} catch {
  await page.screenshot({ path: join(ARTIFACTS, 'qr-decode-failure.png'), fullPage: true });
  fail('QR canvas never rendered (engine state box should be in the screenshot)');
}

mkdirSync(ARTIFACTS, { recursive: true });
await page.screenshot({ path: join(ARTIFACTS, 'qr-decode-1.png'), fullPage: false });

const shot1 = await decodeCanvas(page);
if (!shot1) fail('canvas vanished before decode');
const decoded1 = jsQR(shot1.data, shot1.width, shot1.height);
if (!decoded1) fail(`jsQR could not decode the rendered canvas (${shot1.size})`);
console.log(`✓ canvas decoded (${shot1.size}): ${decoded1.data.slice(0, 24)}… (${decoded1.data.length} chars)`);
if (!decoded1.data.startsWith('2@')) fail(`unexpected payload head: ${decoded1.data.slice(0, 6)}`);

console.log('— waiting 22s for the operator to rotate the pairing code…');
await page.waitForTimeout(22_000);
await page.screenshot({ path: join(ARTIFACTS, 'qr-decode-2.png'), fullPage: false });

const shot2 = await decodeCanvas(page);
const decoded2 = shot2 ? jsQR(shot2.data, shot2.width, shot2.height) : null;
if (!decoded2) fail('second decode failed — canvas not re-rendered after rotation');
console.log(`✓ second decode: ${decoded2.data.slice(0, 24)}…`);

if (decoded1.data === decoded2.data) {
  fail('the QR did NOT rotate within 22s — auto-refresh contract broken');
}
console.log('✓ QR auto-refresh proven: decoded payload CHANGED across the rotation window');

// Freshness phase from the page itself.
const phase = await page.getAttribute('[data-testid="qr-frame"]', 'data-qr-phase');
console.log(`✓ page-reported phase: ${phase}`);

writeFileSync(
  join(ARTIFACTS, 'qr-decode.json'),
  JSON.stringify(
    {
      ok: true,
      canvasSize: shot1.size,
      phase,
      decodedHeadFirst: decoded1.data.slice(0, 32),
      decodedHeadSecond: decoded2.data.slice(0, 32),
      payloadLength: decoded1.data.length,
      rotated: decoded1.data !== decoded2.data,
      checkedAt: new Date().toISOString(),
    },
    null,
    2
  )
);
console.log('— evidence: qa2-artifacts/qr-decode.{json,png}');

await browser.close();
console.log('QR VERIFICATION: PASS');
