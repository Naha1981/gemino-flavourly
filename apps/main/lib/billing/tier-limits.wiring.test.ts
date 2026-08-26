import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const OUTBOX = join(APP, 'api', 'cron', 'outbox', 'route.ts');

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/{\/\*[\s\S]*?\*\/}/g, '');
}

describe('tier limits — outbox dispatcher enforces per-tier gate', () => {
  const src = code(OUTBOX);

  test('the dispatcher evaluates the tier limit before sending', () => {
    assert.match(src, /evaluateTierLimit\(job\.tenantId\)/);
  });

  test('an hourly-rate block DEFERS the job (message stays pending, not lost)', () => {
    assert.match(src, /reason === 'hourly_rate_exceeded'/);
    assert.match(src, /nextRunAt: new Date\(Date\.now\(\) \+ 10 \* 60_000\)/);
  });

  test('a monthly-quota block fails the job visibly (renew to resume)', () => {
    assert.match(src, /tierLimitMessage\(limit\.reason\)/);
  });
});
