import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESPONDER = join(HERE, 'responder.ts');
const CANCEL_INTENT = join(HERE, 'cancel-intent.ts');

/**
 * Gate #3b wiring tests.
 *
 * cancel-intent.test.ts runs the real matcher, the real safety decision and
 * the real Gate #3 integration against in-memory stores. What it cannot see
 * is whether the responder actually wires the intent in: does it run the
 * cancellation intent BEFORE the booking intent (the one ordering bug the
 * spec calls out), does it call the handler, and are all the existing intents
 * left intact? These assertions pin those seams by reading the source —
 * executing the handler would need Clerk and a live database, and mocking
 * that stack would test the mocks. Same style as the Gate #3 wiring tests.
 */

/** Strip comments so prose describing behaviour is not mistaken for code. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

function indexOf(src: string, needle: string): number {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return at;
}

describe('seam 1: the responder wires the cancellation intent ahead of booking', () => {
  const src = code(RESPONDER);

  test('imports the matcher and handler from ./cancel-intent', () => {
    assert.match(src, /import\s*\{[^}]*isCancellationRequest[^}]*\}\s*from\s*['"]\.\/cancel-intent['"]/);
    assert.match(src, /import\s*\{[^}]*handleCancellationIntent[^}]*\}\s*from\s*['"]\.\/cancel-intent['"]/);
  });

  test('the cancellation check runs BEFORE the booking intent (ordering guard)', () => {
    // The whole point of this gate: "cancel my booking" / "cancel my
    // reservation" contain the words "booking" and "reservation", so a booking
    // match placed above the cancel block would swallow the request. Pin the
    // order: the isCancellationRequest branch must come first.
    const cancelIdx = indexOf(src, 'isCancellationRequest(text)');
    const bookingIdx = indexOf(src, "lower.includes('book')");
    assert.ok(cancelIdx < bookingIdx, 'cancellation intent must run before the booking intent');
  });

  test('when the matcher fires, the handler owns the reply (early return, no fall-through)', () => {
    const cancelIdx = indexOf(src, 'isCancellationRequest(text)');
    const tail = src.slice(cancelIdx);
    // The handler is invoked and its result returned within this branch, so a
    // cancel request can never fall through into the booking/menu handlers.
    assert.match(tail, /handleCancellationIntent\(/);
    assert.match(tail, /return\s+await\s+handleCancellationIntent\(/);
  });

  test('the cancel handler is called with tenant, contact, phone and conversation', () => {
    const tail = src.slice(indexOf(src, 'handleCancellationIntent('));
    assert.match(tail, /\{\s*tenantId,\s*contactId,\s*phone,\s*conversationId\s*\}/);
  });

  test('cancelling routes through markReservationCancelled (the only stamp the cron reads)', () => {
    assert.match(
      src,
      /import\s*\{\s*markReservationCancelled\s*\}\s*from\s*['"]@\/lib\/revenue\/cancellation-followup['"]/
    );
    const adapterTail = src.slice(indexOf(src, 'async cancelReservation('));
    assert.match(adapterTail, /markReservationCancelled\(/);
  });
});

describe('seam 2: the cancellation adapter asks the question the logic assumes', () => {
  const src = code(RESPONDER);

  test('takeover is checked from the conversation row (defense in depth)', () => {
    const adapterTail = src.slice(indexOf(src, 'async isManualTakeover('));
    assert.match(adapterTail, /db\.query\.conversations\.findFirst/);
    assert.match(adapterTail, /manualTakeover/);
  });

  test('candidates match by tenant AND (contact OR exact phone)', () => {
    const findTail = src.slice(indexOf(src, 'async findCandidateReservations('));
    assert.match(findTail, /eq\(reservations\.tenantId,\s*tenantId\)/);
    assert.match(findTail, /or\(\s*eq\(reservations\.contactId,\s*contactId\)\s*,\s*eq\(reservations\.customerPhone,\s*phone\)\s*\)/);
  });
});

describe('seam 3: existing intents are unchanged', () => {
  const src = code(RESPONDER);

  test('opt-out/opt-in still run first (POPIA compliance boundary untouched)', () => {
    const optOutIdx = indexOf(src, 'isOptOutMessage(text)');
    const cancelIdx = indexOf(src, 'isCancellationRequest(text)');
    assert.ok(optOutIdx < cancelIdx, 'POPIA opt-out must run before the cancel intent');
    assert.match(src, /isOptInMessage\(text\)/);
  });

  test('loyalty, waitlist, booking, menu and AI fallback are all still present', () => {
    // A booking match placed ABOVE cancel is the bug; a booking match still
    // existing BELOW cancel is the required, unchanged behaviour.
    assert.match(src, /\['points',\s*'balance',\s*'loyalty',\s*'my rewards'\]/);
    assert.match(src, /lower\.startsWith\('waitlist'\)/);
    assert.match(src, /lower\.includes\('book'\)\s*\|\|\s*lower\.includes\('table'\)\s*\|\|\s*lower\.includes\('reservation'\)/);
    assert.match(src, /lower\.includes\('menu'\)/);
    assert.match(src, /GROQ_API_KEY/);
    assert.match(src, /GOOGLE_GEMINI_API_KEY/);
  });
});

describe('seam 4: the matcher is narrow and self-contained', () => {
  const src = code(CANCEL_INTENT);

  test('exports the matcher, the handler, the store type and the reply builders', () => {
    assert.match(src, /export function isCancellationRequest/);
    assert.match(src, /export async function handleCancellationIntent/);
    assert.match(src, /export interface CancelIntentStore/);
    assert.match(src, /export function buildCancellationReply/);
  });

  test('keys off multi-word request phrases, never a bare "cancel"', () => {
    assert.match(src, /'cancel my booking'/);
    assert.match(src, /'cancel my reservation'/);
    assert.match(src, /'i need to cancel'/);
    // The matcher must not reduce to a bare-substring "cancel" check.
    assert.doesNotMatch(src, /includes\(['"]cancel['"]\)/);
  });

  test('leaves the POPIA "cancel subscription" opt-out path untouched', () => {
    assert.match(src, /includes\('subscription'\)/);
  });

  test('is free of any database import (unit-testable without DATABASE_URL)', () => {
    assert.doesNotMatch(src, /from\s+['"]@\/lib\/db['"]/);
    assert.doesNotMatch(src, /from\s+['"]drizzle-orm['"]/);
  });
});
