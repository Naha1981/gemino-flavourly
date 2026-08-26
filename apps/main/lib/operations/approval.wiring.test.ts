import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Seam/source-contract tests for the approval workflow (Engine 6).
 * Verifies the WIRING — that the webhook actually classifies + holds, and that
 * approving a request dispatches it — without needing Postgres/Clerk. Behaviour
 * is covered by approval-classifier.test.ts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');

const WEBHOOK = join(APP, 'api', 'webhooks', 'whatsapp', 'route.ts');
const APPROVE_ROUTE = join(APP, 'api', 'operations', 'approval-requests', '[id]', 'route.ts');
const APPROVE_STORE = join(HERE, 'approval-request-store.ts');

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/{\/\*[\s\S]*?\*\/}/g, '');
}

describe('approval workflow — webhook gates AI auto-send', () => {
  const src = code(WEBHOOK);

  test('imports the risk classifier and the approval store', () => {
    assert.match(src, /classifyMessageRisk/);
    assert.match(src, /createApprovalRequest/);
  });

  test('an auto_send decision enqueues to the outbox', () => {
    assert.match(src, /outcome === 'auto_send'/);
    assert.match(src, /enqueueOutboundMessage\(tenantId, waAccountId, fromPhone, aiReply\)/);
  });

  test('a require_approval decision holds the message instead of sending it', () => {
    assert.match(src, /outcome === 'require_approval'/);
    assert.match(src, /createApprovalRequest\(\{/);
    assert.match(src, /riskLevel: decision\.riskLevel/);
  });
});

describe('approval workflow — approving dispatches the held message', () => {
  test('the approve route calls dispatchApprovedRequest, not just a status flip', () => {
    const src = code(APPROVE_ROUTE);
    assert.match(src, /dispatchApprovedRequest\(tenant\.id, requestId, approvedBy\)/);
    assert.doesNotMatch(src, /updateApprovalStatus\(tenant\.id, requestId, status as 'approved'/);
  });

  test('the store enqueues a send_whatsapp job on approval and reconciles the held row', () => {
    const src = code(APPROVE_STORE);
    assert.match(src, /dispatchApprovedRequest/);
    assert.match(src, /type: 'send_whatsapp'/);
    assert.match(src, /deliveryStatus: 'queued'/);
    assert.match(src, /updateApprovalStatus\(tenantId, requestId, 'approved', approvedBy\)/);
  });
});
