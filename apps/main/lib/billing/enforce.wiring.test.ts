import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const LIB = join(HERE, '..', '..', 'lib');

function src(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return src(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

function from(srcStr: string, needle: string): string {
  const at = srcStr.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return srcStr.slice(at);
}

const RESPONDER = join(LIB, 'ai', 'responder.ts');
const REACT_CRON = join(APP, 'api', 'cron', 'reactivation-campaigns', 'route.ts');
const REACT_RUNNER = join(LIB, 'customer', 'reactivation-cron.ts');
const REVIEW_CRON = join(APP, 'api', 'cron', 'review-requests', 'route.ts');
const REVIEW_RUNNER = join(LIB, 'reputation', 'review-request-cron.ts');
const CANCEL_CRON = join(APP, 'api', 'cron', 'cancellation-followup', 'route.ts');
const CANCEL_RUNNER = join(LIB, 'revenue', 'cancellation-followup.ts');
const NOSHOW_CRON = join(APP, 'api', 'cron', 'no-show-detect', 'route.ts');
const NOSHOW_RUNNER = join(LIB, 'revenue', 'no-show.ts');
const CAMPAIGN_LAUNCH = join(APP, 'api', 'marketing', 'campaigns', '[id]', 'launch', 'route.ts');
const GATE_EVAL = join(LIB, 'billing', 'gate-evaluate.ts');

describe('billing gate — AI responder enforcement', () => {
  test('responder imports the pure billing gate', () => {
    const s = code(RESPONDER);
    assert.match(s, /from\s+['"]@\/lib\/billing\/gate['"]/);
    assert.match(s, /decideBillingGate/);
  });

  test('responder enforces billing gate after AI-enabled check and before AI generation', () => {
    const body = from(code(RESPONDER), 'export async function processInboundAIResponse');
    const aiCheck = body.indexOf('!tenant.aiEnabled');
    const gateCall = body.indexOf('decideBillingGate(');
    const optOut = body.indexOf('isOptOutMessage');
    assert.ok(aiCheck > -1, 'AI-enabled check missing');
    assert.ok(gateCall > aiCheck, 'billing gate must run after the AI-enabled check');
    assert.ok(optOut > gateCall, 'billing gate must gate before AI generation begins');
  });

  test('super-admin tenant bypasses the billing gate in the responder', () => {
    const body = from(code(RESPONDER), 'export async function processInboundAIResponse');
    assert.match(body, /isSuperAdminTenant\(tenant\.ownerEmail\)/);
    const bypass = body.indexOf('isSuperAdminTenant');
    const gate = body.indexOf('decideBillingGate(');
    assert.ok(bypass > -1 && gate > -1, 'bypass and gate both present');
  });
});

describe('billing gate — reactivation campaigns enforcement', () => {
  test('reactivation route wires canSendAutomatedMessages into the runner', () => {
    const s = code(REACT_CRON);
    assert.match(s, /canSendAutomatedMessages/);
    assert.match(s, /isSendable:\s*canSendAutomatedMessages/);
  });

  test('reactivation runner accepts and applies an isSendable predicate', () => {
    const s = code(REACT_RUNNER);
    assert.match(s, /isSendable\?:\s*\(tenantId:\s*string\)/);
    const body = from(s, 'export async function runReactivationCampaignCron');
    assert.match(body, /options\.isSendable/);
    // The gate skip must increment tenantDisabled (reuse the existing bucket).
    const gateBlock = from(body, 'options.isSendable');
    assert.match(gateBlock, /tenantDisabled \+= 1/);
  });
});

describe('billing gate — review requests enforcement', () => {
  test('review-request route wires canSendAutomatedMessages into the runner', () => {
    const s = code(REVIEW_CRON);
    assert.match(s, /isSendable:\s*canSendAutomatedMessages/);
  });

  test('review-request runner applies an isSendable predicate', () => {
    const s = code(REVIEW_RUNNER);
    assert.match(s, /isSendable\?:\s*\(tenantId:\s*string\)/);
    const body = from(s, 'export async function runReviewRequestCron');
    assert.match(body, /options\.isSendable/);
  });
});

describe('billing gate — cancellation follow-up enforcement', () => {
  test('cancellation-followup route wires canSendAutomatedMessages', () => {
    const s = code(CANCEL_CRON);
    assert.match(s, /isSendable:\s*canSendAutomatedMessages/);
  });

  test('cancellation-followup runner applies isSendable per reservation', () => {
    const s = code(CANCEL_RUNNER);
    assert.match(s, /isSendable\?:\s*\(tenantId:\s*string\)/);
    const body = from(s, 'export async function runCancellationFollowupCron');
    assert.match(body, /options\.isSendable\(reservation\.tenantId\)/);
  });
});

describe('billing gate — no-show follow-up enforcement', () => {
  test('no-show route wires canSendAutomatedMessages', () => {
    const s = code(NOSHOW_CRON);
    assert.match(s, /isSendable:\s*canSendAutomatedMessages/);
  });

  test('no-show runner applies isSendable per reservation in phase 2', () => {
    const s = code(NOSHOW_RUNNER);
    assert.match(s, /isSendable\?:\s*\(tenantId:\s*string\)/);
    const body = from(s, 'export async function runNoShowCron');
    assert.match(body, /options\.isSendable\(candidate\.tenantId\)/);
  });
});

describe('billing gate — campaign launch enforcement', () => {
  test('campaign launch route enforces the billing gate before launching', () => {
    const s = code(CAMPAIGN_LAUNCH);
    assert.match(s, /canSendAutomatedMessages\(tenant\.id\)/);
    assert.match(s, /status:\s*402/);
    const body = from(s, 'export async function POST');
    const gateAt = body.indexOf('canSendAutomatedMessages');
    const enqueueAt = body.indexOf('insert(jobs)');
    assert.ok(gateAt > -1 && enqueueAt > gateAt, 'gate must run before any job is enqueued');
  });
});

describe('billing gate — module seam', () => {
  test('enforcement points import from gate-evaluate (DB wrapper), not gate (pure)', () => {
    const evalSrc = code(GATE_EVAL);
    assert.match(evalSrc, /canSendAutomatedMessages/);
    assert.match(evalSrc, /evaluateBillingGate/);
  });
});
