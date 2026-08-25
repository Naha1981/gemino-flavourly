import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  channelAdapters,
  getChannelAdapter,
  type ChannelAdapter,
} from './channels/index.ts';
import { buildChannelContext, coerceTimestamp, buildInboundMessage } from './normalize.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Every adapter file must implement the ChannelAdapter interface. */
function assertImplements(name: string, adapter: ChannelAdapter) {
  assert.equal(adapter.channel, name, `${name} adapter channel mismatch`);
  assert.equal(typeof adapter.fetchMessages, 'function', `${name}.fetchMessages missing`);
  assert.equal(typeof adapter.sendMessage, 'function', `${name}.sendMessage missing`);
  assert.equal(typeof adapter.markAsRead, 'function', `${name}.markAsRead missing`);
}

describe('channel adapter registry', () => {
  test('every channel has a registered adapter', () => {
    for (const ch of ['whatsapp', 'email', 'instagram', 'facebook', 'web']) {
      const adapter = getChannelAdapter(ch);
      assert.ok(adapter, `no adapter for ${ch}`);
      assertImplements(ch, adapter!);
    }
  });

  test('getChannelAdapter returns null for unknown channels', () => {
    assert.equal(getChannelAdapter('telegram'), null);
  });

  test('registry exposes all five adapters', () => {
    assert.equal(Object.keys(channelAdapters).length, 5);
  });
});

describe('channel adapter behaviour', () => {
  test('stub channels fetch no messages and never fake a send', async () => {
    for (const ch of ['email', 'instagram', 'facebook'] as const) {
      const adapter = channelAdapters[ch];
      const msgs = await adapter.fetchMessages({ tenantId: 't1', channel: ch, secrets: {} });
      assert.deepEqual(msgs, [], `${ch} should fetch an empty list (stub)`);

      const sent = await adapter.sendMessage({ tenantId: 't1', channel: ch, secrets: {} }, 'x', 'hi');
      assert.equal(sent.ok, false, `${ch} must not report a fake success`);
      assert.ok(sent.error, `${ch} should explain why send failed`);
    }
  });

  test('whatsapp fetch returns nothing (webhook-owned) and markAsRead is a no-op', async () => {
    const wa = channelAdapters.whatsapp;
    assert.deepEqual(await wa.fetchMessages({ tenantId: 't1', channel: 'whatsapp', secrets: {} }), []);
    assert.equal((await wa.markAsRead({ tenantId: 't1', channel: 'whatsapp', secrets: {} }, 'm1')).ok, true);
  });
});

describe('normalize helpers', () => {
  test('buildChannelContext decrypts and parses provider secrets', () => {
    // secret-box stores plaintext when no master key is configured. Build a
    // plaintext payload the same way the encryptor would downgrade.
    const plain = 'plain:' + JSON.stringify({ apiKey: 'abc', waAccountId: 'wa_1' });
    const ctx = buildChannelContext('tenant-1', 'email', plain);
    assert.equal(ctx.tenantId, 'tenant-1');
    assert.equal(ctx.channel, 'email');
    assert.equal(ctx.secrets.apiKey, 'abc');
    assert.equal(ctx.secrets.waAccountId, 'wa_1');
  });

  test('buildChannelContext tolerates unparseable / null secrets', () => {
    assert.deepEqual(buildChannelContext('t', 'email', null).secrets, {});
    assert.deepEqual(buildChannelContext('t', 'email', 'plain:not-json').secrets, {});
  });

  test('coerceTimestamp falls back to now on garbage', () => {
    assert.ok(coerceTimestamp('').getTime() <= Date.now() + 1000);
    assert.ok(!Number.isNaN(coerceTimestamp('2024-01-02T03:04:05Z').getTime()));
  });

  test('buildInboundMessage maps a normalized message to a tenant-scoped insert', () => {
    const record = buildInboundMessage(
      {
        channel: 'email',
        from: 'cust@x.com',
        to: 'resto@x.com',
        text: 'hello',
        timestamp: '2024-01-02T03:04:05Z',
        externalId: 'ext_9',
      },
      { tenantId: 't1', contactId: 'c1', conversationId: 'cv1', waAccountId: null }
    );
    assert.equal(record.tenantId, 't1');
    assert.equal(record.contactId, 'c1');
    assert.equal(record.conversationId, 'cv1');
    assert.equal(record.direction, 'inbound');
    assert.equal(record.waMessageId, 'ext_9');
    assert.equal(record.isAIGenerated, false);
    assert.equal(record.createdAt.toISOString(), '2024-01-02T03:04:05.000Z');
  });
});

describe('aggregate-messages cron route wiring', () => {
  test('route imports and calls the shared guard before any db access', () => {
    const src = read(join(HERE, '..', '..', 'app', 'api', 'cron', 'aggregate-messages', 'route.ts'));
    assert.match(src, /import\s*\{[^}]*assertCronAuthorized[^}]*\}\s*from\s*'@\/lib\/cron\/auth'/);
    assert.match(src, /assertCronAuthorized\(req\)/);
    assert.match(src, /if\s*\(\s*authError\s*\)\s*return\s+authError\s*;/);
    assert.ok(src.indexOf('assertCronAuthorized(req)') < src.search(/\bdb\s*\./) || src.search(/\bdb\s*\./) === -1, 'guard must precede db access');
  });
});
