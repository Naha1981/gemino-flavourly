import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * G0.3 seam-level tests for the outbound message pipeline:
 *
 *   manual reply  -> operator send -> outbox job -> message delivery state
 *   inbound hook  -> job           -> outbox      -> operator send
 *
 * Executing these routes for real would require Postgres, Clerk and a
 * live operator; mocking that entire stack would mostly test the mocks.
 * These assertions instead verify the WIRING between components — that
 * each seam is connected and ordered correctly — which is precisely the
 * class of defect G0.3 fixes (a value written at one seam and never read
 * at the next).
 *
 * The behavioural logic itself is covered by dispatch.test.ts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');

const MANUAL_REPLY_ROUTE = join(APP, 'api', 'conversations', '[id]', 'messages', 'route.ts');
const OUTBOX_ROUTE = join(APP, 'api', 'cron', 'outbox', 'route.ts');
const WEBHOOK_ROUTE = join(APP, 'api', 'webhooks', 'whatsapp', 'route.ts');
const CHAT_CLIENT = join(APP, 'dashboard', 'inbox', '[id]', 'chat-detail-client.tsx');

/** Strip comments so prose describing an old behaviour is not matched. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

describe('seam 1: manual reply decides dispatch through the shared module', () => {
  const src = code(MANUAL_REPLY_ROUTE);

  test('imports the dispatch decision helpers', () => {
    assert.match(src, /findDispatchBlocker/);
    assert.match(src, /resolveDispatchOutcome/);
    assert.match(src, /from\s+'@\/lib\/messaging\/dispatch'/);
  });

  test('does not gate the whole dispatch on a truthy waAccountId', () => {
    // The original bug: `if (convo.waAccountId)` wrapped BOTH the send and
    // the fallback, so a null account silently dropped the message.
    assert.match(src, /findDispatchBlocker\(\s*convo\.waAccountId\s*\)/);
  });

  test('the response status is derived from the outcome, not hardcoded 200', () => {
    assert.match(src, /dispatchHttpStatus\(\s*outcome\s*\)/);
    assert.doesNotMatch(src, /ok:\s*true\s*,\s*message:\s*newMessage\s*\}\s*\)\s*;\s*$/m);
  });

  test('ok reflects the real outcome rather than being a literal true', () => {
    assert.match(src, /ok:\s*outcome\.accepted/);
  });

  test('persists the delivery state onto the message row', () => {
    assert.match(src, /deliveryStatus:\s*outcome\.status/);
  });

  test('passes messageId into the job payload so the outbox can reconcile it', () => {
    assert.match(src, /messageId:\s*newMessage\.id/);
  });
});

describe('seam 2: outbox reconciles job outcomes back to the message row', () => {
  const src = code(OUTBOX_ROUTE);

  test('reads payload.messageId (it was written but never read before)', () => {
    assert.match(src, /messageId\?:\s*string/);
  });

  test('marks the message sent on success', () => {
    assert.match(src, /markMessageDelivery\(\s*payload\.messageId\s*,\s*'sent'/);
  });

  test('marks the message failed only once retries are exhausted', () => {
    assert.match(src, /if\s*\(\s*isExhausted\s*\)/);
    assert.match(src, /markMessageDelivery\([^)]*'failed'/);
  });

  test('does not mark a message failed while attempts remain', () => {
    // The 'failed' update must sit inside the isExhausted branch, i.e.
    // after it in source order, not before.
    const exhaustedAt = src.indexOf('if (isExhausted)');
    const failedAt = src.indexOf("'failed'", exhaustedAt);
    assert.ok(exhaustedAt > -1, 'isExhausted branch not found');
    assert.ok(failedAt > exhaustedAt, 'failed marking is not gated on exhausted retries');
  });

  test('a delivery-status update failure cannot abort the job run', () => {
    assert.match(src, /catch[\s\S]{0,200}Failed to update delivery status/);
  });

  test('still claims jobs atomically (G0.1/earlier behaviour preserved)', () => {
    assert.match(src, /eq\(jobs\.status,\s*'pending'\)/);
  });
});

describe('seam 3: inbound webhook enqueues through the outbox', () => {
  const src = code(WEBHOOK_ROUTE);

  test('verifies the signature before enqueuing anything', () => {
    // Scoped to the POST handler body: enqueueOutboundMessage() is a
    // helper declared ABOVE POST, so its insert(jobs) sits at a lower
    // string index despite only running after verification. Comparing
    // raw file positions would be measuring declaration order, not
    // execution order.
    const postAt = src.indexOf('export async function POST(');
    assert.ok(postAt > -1, 'POST handler not found');
    const body = src.slice(postAt);

    const verifyAt = body.indexOf('verifyWebhookSignature(');
    assert.ok(verifyAt > -1, 'verification not called inside POST');

    for (const marker of ['insert(jobs)', 'enqueueOutboundMessage(']) {
      const at = body.indexOf(marker);
      if (at > -1) {
        assert.ok(verifyAt < at, `${marker} runs before signature verification`);
      }
    }
  });

  test('AI replies are queued as send_whatsapp jobs', () => {
    assert.match(src, /type:\s*'send_whatsapp'/);
  });
});

describe('seam 4: the UI surfaces delivery state', () => {
  const src = code(CHAT_CLIENT);

  test('renders a distinct state for failed delivery', () => {
    assert.match(src, /deliveryStatus === 'failed'/);
    assert.match(src, /Not delivered/);
  });

  test('renders a pending state for queued messages', () => {
    assert.match(src, /deliveryStatus === 'queued'/);
  });

  test('the delivered tick is conditional, not unconditional', () => {
    // Regression guard: previously every outbound message rendered a green
    // double-check regardless of whether it was ever delivered.
    assert.match(src, /deliveryStatus === 'sent' &&[\s\S]{0,120}CheckCheck/);
    assert.doesNotMatch(src, /\{!isInbound && <CheckCheck/);
  });

  test('a non-ok response is not treated as a successful send', () => {
    assert.match(src, /!res\.ok/);
  });
});
