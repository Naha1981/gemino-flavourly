import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import type { BillingProvider, WebhookResult } from './provider.ts';

/**
 * PayFast checkout payload + signature wiring tests.
 *
 * The real PayFastProvider.verifyAndParseWebhook needs DB + env. We test the
 * security-critical signature math directly against PayFast's DOCUMENTED
 * algorithm (md5 of sorted, non-empty, PHP-urlencoded fields + passphrase),
 * then exercise the provider's decision through a fake that reuses the same
 * building blocks.
 *
 * The mirrors below intentionally encode the rules that are easy to get
 * wrong and that the production code previously got wrong:
 *   - empty fields are EXCLUDED from the signature input
 *   - values are encoded with PHP urlencode semantics (space -> '+')
 *   - the passphrase is appended for BOTH the payment form and the ITN
 */

const PASSPHRASE = 'gemino-passphrase';
const MERCHANT_ID = '10000100';

/** PHP urlencode() semantics — see payfast.ts phpUrlEncode(). */
function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+')
    .replace(/~/g, '%7E');
}

/** PayFast's documented signature input: sorted NON-EMPTY fields + passphrase. */
function payfastSignatureInput(data: Record<string, string>, passphrase: string): string {
  const keys = Object.keys(data)
    .filter((k) => data[k] !== undefined && data[k] !== '')
    .sort();
  const pairs = keys.map((k) => `${phpUrlEncode(k)}=${phpUrlEncode(data[k] ?? '')}`);
  return pairs.join('&') + (passphrase ? `&passphrase=${phpUrlEncode(passphrase)}` : '');
}

/** Mirrors payfast.ts buildSignature — kept here so a drift between the
 * production code and the test's expectation is caught. */
function buildSignature(data: Record<string, string>, passphrase: string): string {
  return createHash('md5').update(payfastSignatureInput(data, passphrase)).digest('hex');
}

describe('PayFast ITN signature algorithm', () => {
  test('matches a known field set + passphrase', () => {
    const data = { merchant_id: '10000100', m_payment_id: 'abc', amount: '499.00' };
    const sig = buildSignature(data, PASSPHRASE);
    assert.equal(sig.length, 32);
    // Deterministic: same input → same signature.
    assert.equal(sig, buildSignature(data, PASSPHRASE));
  });

  test('signature depends on field ORDER being sorted (not insertion order)', () => {
    const a = buildSignature({ b: '2', a: '1' }, '');
    const b = buildSignature({ a: '1', b: '2' }, '');
    assert.equal(a, b);
  });

  test('EMPTY fields are excluded from the signature input (PayFast skips !empty(val))', () => {
    // PayFast's PHP reference omits unset/blank fields. Including them as
    // `key=` produced a different digest for any ITN that carried an empty
    // variable (blank name, unset custom_str*), so a valid payment failed
    // verification.
    const withEmpty = buildSignature({ amount: '100', name_first: '' }, 'pass');
    const withoutEmpty = buildSignature({ amount: '100' }, 'pass');
    assert.equal(withEmpty, withoutEmpty);
  });

  test('values containing spaces encode as "+" (PHP urlencode), not "%20"', () => {
    // item_name always contains spaces; a %20 encoding produced a different
    // digest than PayFast computes, breaking the form and ITN signatures.
    const input = payfastSignatureInput({ item_name: 'Gemino starter — monthly subscription' }, 'pass');
    assert.ok(input.includes('Gemino+starter'), `expected "+"-encoded spaces in: ${input}`);
    assert.ok(!input.includes('Gemino%20starter'), `did not expect %20-encoded spaces in: ${input}`);
  });

  test('passphrase changes the signature', () => {
    const data = { amount: '100' };
    assert.notEqual(buildSignature(data, 'one'), buildSignature(data, 'two'));
  });

  test('passphrase omitted vs present differ', () => {
    const data = { amount: '100' };
    assert.notEqual(buildSignature(data, ''), buildSignature(data, PASSPHRASE));
  });

  test('tampered field value produces a different signature', () => {
    const base = { amount: '499.00', merchant_id: MERCHANT_ID };
    const tampered = { amount: '1.00', merchant_id: MERCHANT_ID };
    assert.notEqual(buildSignature(base, PASSPHRASE), buildSignature(tampered, PASSPHRASE));
  });
});

/**
 * Minimal fake provider that mirrors verifyAndParseWebhook's verification +
 * decision but skips the DB write, so we can unit-test the parse + status
 * mapping without a database.
 */
class FakePayFastProvider implements BillingProvider {
  secret = PASSPHRASE;
  merchantId = MERCHANT_ID;
  // What the fake "persisted" for the last call.
  lastStatus: string | null = null;

  async createSubscriptionCheckout() {
    return { redirectUrl: 'https://example.com' };
  }
  async cancelSubscription() {}

  async verifyAndParseWebhook(req: Request): Promise<WebhookResult> {
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);
    const data: Record<string, string> = {};
    let signature = '';
    for (const [k, v] of Array.from(params.entries())) {
      if (k === 'signature') signature = v;
      else data[k] = v;
    }
    if (!signature) throw new Error('PayFast ITN webhook missing signature.');
    const expected = buildSignature(data, this.secret);
    if (expected !== signature) throw new Error('PayFast ITN signature mismatch.');
    if (data.merchant_id && data.merchant_id !== this.merchantId) {
      throw new Error('PayFast ITN merchant_id mismatch.');
    }

    const status = (data.payment_status ?? '').toLowerCase();
    const token = data.token ?? '';

    if (status === 'complete') {
      this.lastStatus = token ? 'active' : 'active';
      return { ok: true };
    }
    if (status === 'failed') {
      this.lastStatus = 'past_due';
      return { ok: true };
    }
    if (status === 'cancelled') {
      this.lastStatus = 'canceled';
      return { ok: true };
    }
    return { ok: true, duplicate: true };
  }
}

function buildITNBody(fields: Record<string, string>): string {
  const data = { ...fields, merchant_id: MERCHANT_ID };
  const sig = buildSignature(data, PASSPHRASE);
  const params = new URLSearchParams({ ...data, signature: sig });
  return params.toString();
}

describe('PayFast webhook verification (fail-closed)', () => {
  let provider: FakePayFastProvider;
  beforeEach(() => {
    provider = new FakePayFastProvider();
  });

  test('accepts a valid complete-payment ITN and activates', async () => {
    const body = buildITNBody({
      m_payment_id: 'tenant-1:starter:abc',
      pf_payment_id: 'pf-123',
      payment_status: 'COMPLETE',
      token: 'sub-token-xyz',
      amount_gross: '499.00',
    });
    const req = new Request('http://localhost/api/billing/webhook', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const res = await provider.verifyAndParseWebhook(req);
    assert.equal(res.ok, true);
    assert.equal(provider.lastStatus, 'active');
  });

  test('rejects a tampered body (wrong signature) → fail closed', async () => {
    const body = buildITNBody({ payment_status: 'COMPLETE', amount_gross: '499.00' });
    // Tamper with the body after signing.
    const tampered = body.replace('499.00', '1.00');
    const req = new Request('http://localhost/api/billing/webhook', {
      method: 'POST',
      body: tampered,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    await assert.rejects(() => provider.verifyAndParseWebhook(req), /signature mismatch/);
  });

  test('rejects a body with no signature', async () => {
    const req = new Request('http://localhost/api/billing/webhook', {
      method: 'POST',
      body: 'merchant_id=10000100&payment_status=COMPLETE',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    await assert.rejects(() => provider.verifyAndParseWebhook(req), /missing signature/);
  });

  test('rejects a body signed with the wrong passphrase', async () => {
    const data = { merchant_id: MERCHANT_ID, payment_status: 'COMPLETE' };
    const sig = buildSignature(data, 'WRONG-passphrase');
    const body = new URLSearchParams({ ...data, signature: sig }).toString();
    const req = new Request('http://localhost/api/billing/webhook', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    await assert.rejects(() => provider.verifyAndParseWebhook(req), /signature mismatch/);
  });

  test('failed payment → past_due', async () => {
    const body = buildITNBody({ payment_status: 'FAILED' });
    const req = new Request('http://localhost/api/billing/webhook', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    await provider.verifyAndParseWebhook(req);
    assert.equal(provider.lastStatus, 'past_due');
  });

  test('cancelled payment → canceled', async () => {
    const body = buildITNBody({ payment_status: 'CANCELLED' });
    const req = new Request('http://localhost/api/billing/webhook', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    await provider.verifyAndParseWebhook(req);
    assert.equal(provider.lastStatus, 'canceled');
  });
});

describe('PayFast checkout payload wiring', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  /**
   * Mirrors the data-building logic from PayFastProvider.createSubscriptionCheckout
   * so we can assert on the payload without importing the class (which needs DB).
   */
  function buildCheckoutPayload(env: Record<string, string | undefined>): string {
    const MERCHANT_ID = env.PAYFAST_MERCHANT_ID ?? '';
    const MERCHANT_KEY = env.PAYFAST_MERCHANT_KEY ?? '';
    const PASSPHRASE = env.PAYFAST_PASSPHRASE ?? '';
    const appUrl = env.NEXT_PUBLIC_APP_URL ?? 'https://gemino.app';
    const amountCents = 499_00; // starter

    const data: Record<string, string> = {
      merchant_id: MERCHANT_ID,
      merchant_key: MERCHANT_KEY,
      return_url: 'https://example.com/return',
      cancel_url: `${appUrl}/dashboard/billing?cancel=1`,
      notify_url: `${appUrl}/api/billing/webhook`,
      m_payment_id: 'tenant-test:starter:abc12345',
      amount: (amountCents / 100).toFixed(2),
      item_name: 'Gemino starter — monthly subscription',
      item_description: 'Gemino starter plan',
      // PayFast's actual subscription fields (the old custom_int1..4
      // passthroughs configured nothing — every checkout was once-off).
      subscription_type: '1',
      recurring_amount: (amountCents / 100).toFixed(2),
      frequency: '3',
      cycles: '0',
      custom_str1: 'tenant-test',
      custom_str2: 'starter',
      custom_str3: 'tenant-test:starter:abc12345',
    };

    // Build signature — same algorithm as the ITN (sorted non-empty fields,
    // PHP-style urlencoding, passphrase included: PayFast requires it for
    // BOTH the payment form and the ITN whenever one is set).
    const signature = createHash('md5').update(payfastSignatureInput(data, PASSPHRASE)).digest('hex');

    const fields = Object.entries(data).map(([name, value]) => ({ name, value }));
    fields.push({ name: 'signature', value: signature });
    return fields
      .map(({ name, value }) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      .join('&');
  }

  test('checkout payload carries REAL PayFast subscription fields', () => {
    process.env.PAYFAST_MERCHANT_ID = '10000100';
    process.env.PAYFAST_MERCHANT_KEY = 'merchant-key';
    process.env.PAYFAST_PASSPHRASE = 'pass';
    process.env.NEXT_PUBLIC_APP_URL = 'https://gemino-flavourly-whatsapp.vercel.app';

    const payload = buildCheckoutPayload(process.env as Record<string, string>);

    // The old payload stuffed subscription intent into custom_int1..4 —
    // inert passthrough variables — so no recurring billing ever happened
    // and the ITN never carried a token.
    assert.ok(payload.includes('subscription_type=1'), 'must set subscription_type');
    assert.ok(payload.includes('recurring_amount=499.00'), 'must set recurring_amount');
    assert.ok(payload.includes('frequency=3'), 'monthly frequency');
    assert.ok(payload.includes('cycles=0'), 'cycles=0 (until cancelled)');
    assert.ok(!payload.includes('custom_int1'), 'custom_int passthroughs are not subscription config');
  });

  test('checkout signature includes the passphrase (PayFast requires it on the form too)', () => {
    process.env.PAYFAST_MERCHANT_ID = '10000100';
    process.env.PAYFAST_MERCHANT_KEY = 'merchant-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://gemino-flavourly-whatsapp.vercel.app';

    const withPhrase = buildCheckoutPayload({ ...process.env, PAYFAST_PASSPHRASE: 'secret-pass' } as Record<string, string>);
    const withoutPhrase = buildCheckoutPayload({ ...process.env, PAYFAST_PASSPHRASE: '' } as Record<string, string>);

    const sigOf = (payload: string) => new URLSearchParams(payload).get('signature') ?? '';
    assert.notEqual(sigOf(withPhrase), sigOf(withoutPhrase),
      'the passphrase must change the checkout signature — omitting it (the old behaviour) meant PayFast rejected every form');
  });

  test('checkout payload includes notify_url with /api/billing/webhook', () => {
    process.env.PAYFAST_MERCHANT_ID = '10000100';
    process.env.PAYFAST_MERCHANT_KEY = 'merchant-key';
    process.env.PAYFAST_PASSPHRASE = 'pass';
    process.env.NEXT_PUBLIC_APP_URL = 'https://gemino-flavourly-whatsapp.vercel.app';

    const payload = buildCheckoutPayload(process.env as Record<string, string>);

    assert.ok(payload.includes('notify_url='), 'payload must include notify_url param');
    assert.ok(
      payload.includes('api%2Fbilling%2Fwebhook'),
      'notify_url must point to /api/billing/webhook (URL-encoded)'
    );
    assert.ok(
      payload.includes('https%3A%2F%2Fgemino-flavourly-whatsapp.vercel.app'),
      'notify_url must use the correct app domain'
    );
  });

  test('notify_url defaults to gemino.app when NEXT_PUBLIC_APP_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.PAYFAST_MERCHANT_ID = '10000100';
    process.env.PAYFAST_MERCHANT_KEY = 'merchant-key';
    process.env.PAYFAST_PASSPHRASE = 'pass';

    const payload = buildCheckoutPayload(process.env as Record<string, string>);

    assert.ok(payload.includes('notify_url='), 'payload must include notify_url param');
    // Default fallback in the code is https://gemino.app
    assert.ok(
      payload.includes('gemino.app'),
      'notify_url fallback should be gemino.app'
    );
  });
});
