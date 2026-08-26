import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const CRON = join(APP, 'api', 'cron', 'vip-alerts', 'route.ts');

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/{\/\*[\s\S]*?\*\/}/g, '');
}

describe('VIP daily brief — cron wiring', () => {
  test('the cron is guarded and builds the brief via the pure module', () => {
    const src = code(CRON);
    assert.match(src, /assertCronAuthorized\(req\)/);
    assert.match(src, /buildVipDailyBrief\(/);
    assert.match(src, /listVipAlertsToday\(/);
  });

  test('a brief with VIPs is queued to the tenant WhatsApp via the outbox', () => {
    const src = code(CRON);
    assert.match(src, /type: 'send_whatsapp'/);
    assert.match(src, /insert\(jobs\)/);
  });
});
