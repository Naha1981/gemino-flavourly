import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const CRON = join(APP, 'api', 'cron', 'birthday-rewards', 'route.ts');
const STORE = join(HERE, 'birthday-store.ts');

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/{\/\*[\s\S]*?\*\/}/g, '');
}

describe('birthday rewards — cron wiring', () => {
  test('the cron is guarded by assertCronAuthorized', () => {
    const src = code(CRON);
    assert.match(src, /assertCronAuthorized\(req\)/);
    assert.match(src, /runBirthdayRewards\(\)/);
  });

  test('the store queues rewards through the outbox and never messages opted-out contacts', () => {
    const src = code(STORE);
    assert.match(src, /selectBirthdayRewards\(/);
    assert.match(src, /type: 'send_whatsapp'/); // outbox job
    // POPIA filter: `blocklisted` is NOT NULL, so the filter must be
    // eq(..., false) — isNull(...) on a NOT NULL column matches zero rows
    // (the old form silently disabled the entire birthday cron).
    assert.match(src, /eq\(contacts\.blocklisted,\s*false\)/);
    assert.doesNotMatch(src, /isNull\(contacts\.blocklisted\)/);
  });
});
