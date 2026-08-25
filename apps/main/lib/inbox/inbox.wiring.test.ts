import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const LIB = join(HERE, '..');
const INBOX_PAGE = join(APP, 'dashboard', 'inbox', 'page.tsx');
const AGGREGATOR = join(LIB, 'inbox', 'aggregator.ts');
const CRON_ROUTE = join(APP, 'api', 'cron', 'aggregate-messages', 'route.ts');

function src(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return src(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

describe('inbox multi-channel wiring', () => {
  test('inbox page reads ?channel= and filters conversations', () => {
    const page = code(INBOX_PAGE);
    assert.match(page, /searchParams/);
    assert.match(page, /\?channel=/);
    assert.ok(page.includes('activeChannel'), 'page should track the active channel filter');
    assert.match(page, /conversations\.channel/);
  });

  test('inbox page renders a per-conversation channel icon', () => {
    const page = src(INBOX_PAGE);
    assert.match(page, /ChannelIcon/);
    // At least the channel icon set must be wired (whatsapp/email/instagram/facebook/web).
    assert.match(page, /Mail|Instagram|Facebook|Globe/);
  });

  test('aggregator is tenant-scoped end to end', () => {
    const a = code(AGGREGATOR);
    assert.match(a, /eq\(channelConfigs\.tenantId,\s*tenantId\)/);
    assert.match(a, /aggregateAllTenants/);
    // No message is inserted without first resolving the tenant + contact.
    assert.match(a, /getOrCreateContact/);
    assert.match(a, /getOrCreateConversation/);
  });

  test('aggregate-messages cron route is wired to the shared guard', () => {
    const r = code(CRON_ROUTE);
    assert.match(r, /assertCronAuthorized\(req\)/);
    assert.match(r, /if\s*\(\s*authError\s*\)\s*return\s+authError\s*;/);
  });
});
