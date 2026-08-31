import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import {
  BillingProvider,
  CheckoutRequest,
  CheckoutResult,
  PlanTier,
  WebhookResult,
} from './provider';

/**
 * PayFast recurring-billing adapter (South Africa).
 *
 * Flow:
 *  1. createSubscriptionCheckout builds a signed PayFast payment URL with
 *     tokenization enabled (subscription + recurring). The customer pays
 *     once on PayFast's hosted page; PayFast returns a token we store.
 *  2. PayFast fires ITN webhooks (POST to us) for the initial and every
 *     recurring payment. verifyAndParseWebhook validates the MD5 signature
 *     (with passphrase) and updates plan_status accordingly.
 *  3. cancelSubscription suspends the token via the PayFast API.
 *
 * References:
 *  - PayFast API docs: https://www.payfast.co.za/documentation/
 *  - ITN signature = md5(name=value pairs sorted & urlencoded, + passphrase)
 */

const SANDBOX = (process.env.PAYFAST_SANDBOX ?? 'false') === 'true';
const BASE_URL = SANDBOX
  ? 'https://sandbox.payfast.co.za/eng/process'
  : 'https://www.payfast.co.za/eng/process';
const API_URL = SANDBOX
  ? 'https://sandbox.payfast.co.za/subscriptions'
  : 'https://www.payfast.co.za/subscriptions';

const MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID ?? '';
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY ?? '';
const PASSPHRASE = process.env.PAYFAST_PASSPHRASE ?? '';

/** Monthly recurring amount in ZAR cents per tier. */
export const TIER_CENTS: Record<PlanTier, number> = {
  starter: 499_00,
  casual: 1499_00,
  premium: 3999_00,
  signature: 7999_00,
  group: 19999_00,
};

/** One-time setup fee in ZAR cents per tier. */
export const TIER_SETUP_CENTS: Record<PlanTier, number> = {
  starter: 2500_00,
  casual: 5000_00,
  premium: 12500_00,
  signature: 25000_00,
  group: 75000_00,
};

const INTERVAL_MONTHLY = 3; // PayFast: 3 = monthly

interface PayFastField {
  name: string;
  value: string;
}

/**
 * PayFast signs with PHP `urlencode()` semantics (RFC 1738), which differs
 * from JS `encodeURIComponent` in exactly the ways below. Any signed value
 * containing a space — `item_name` always does — produced a different MD5
 * digest with the JS encoder, so PayFast rejected the form / we rejected
 * the ITN even though "the same" algorithm appeared to run on both sides.
 *
 *   PHP urlencode: space -> '+', and ! ' ( ) * ~ are percent-encoded
 *   JS encodeURICompoent: space -> '%20', ! ' ( ) * ~ left as-is
 */
function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+')
    .replace(/~/g, '%7E');
}

/**
 * PayFast's documented signing input: every NON-EMPTY field, keys sorted
 * alphabetically, PHP-style urlencoded, ampersand-joined, with the
 * passphrase appended (also urlencoded) when one is set.
 *
 * Empty fields are OMITTED (their PHP reference skips empty values);
 * including them as `key=` changed the digest whenever PayFast sent an
 * unset custom_str field or a blank name field, so a valid ITN failed
 * verification.
 */
function payfastSignatureInput(data: Record<string, string>, passphrase: string): string {
  const keys = Object.keys(data)
    .filter((k) => data[k] !== undefined && data[k] !== '')
    .sort();
  const pairs = keys.map((k) => `${phpUrlEncode(k)}=${phpUrlEncode(data[k] ?? '')}`);
  const raw = pairs.join('&') + (passphrase ? `&passphrase=${phpUrlEncode(passphrase)}` : '');
  return raw;
}

function md5Hex(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function signaturesEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * PayFast ITN signature: md5 of the signature input (see above).
 */
function buildSignature(data: Record<string, string>, passphrase: string): string {
  return md5Hex(payfastSignatureInput(data, passphrase));
}

/**
 * Build the signature the payment/redirect path uses. PayFast requires the
 * passphrase in the signature for BOTH the payment form and the ITN
 * whenever a passphrase is set on the merchant account — the previous
 * version omitted it here only, so PayFast rejected every checkout form
 * with "signature mismatch" while the ITN verifier (which did include it)
 * stayed internally consistent. Both paths now share one algorithm.
 */
function buildPaymentSignature(data: Record<string, string>): string {
  return md5Hex(payfastSignatureInput(data, PASSPHRASE));
}

function payfastFields(fields: PayFastField[]): string {
  return fields
    .map(({ name, value }) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
}

export class PayFastProvider implements BillingProvider {
  async createSubscriptionCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (!MERCHANT_ID || !MERCHANT_KEY) {
      throw new Error('PayFast merchant credentials are not configured.');
    }
    const { tenantId, tier, returnUrl } = req;
    const amountCents = TIER_CENTS[tier];
    if (!amountCents) throw new Error(`Unknown plan tier: ${tier}`);

    const setupCents = TIER_SETUP_CENTS[tier] ?? 0;

    // m_payment_id links the PayFast transaction back to our tenant so the
    // ITN handler can credit the right row without trusting client input.
    const mPaymentId = `${tenantId}:${tier}:${randomUUID().slice(0, 8)}`;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://gemino.app';

    const data: Record<string, string> = {
      merchant_id: MERCHANT_ID,
      merchant_key: MERCHANT_KEY,
      return_url: returnUrl,
      cancel_url: `${appUrl}/dashboard/billing?cancel=1`,
      notify_url: `${appUrl}/api/billing/webhook`,
      m_payment_id: mPaymentId,
      amount: (amountCents / 100).toFixed(2),
      item_name: `Gemino ${tier} — monthly subscription`,
      item_description: `Gemino ${tier} plan${setupCents ? ` (setup R${(setupCents / 100).toFixed(2)})` : ''}`,
      // Recurring billing per PayFast's subscription spec. The previous
      // payload invented `subscription=true` / `recurring_type` (not PayFast
      // fields) and stuffed the intent into `custom_int1..4`, which are
      // inert passthrough variables — so every checkout was a plain ONCE-OFF
      // payment: no recurring charge ever ran, and the ITN carried no
      // `token`, so `payfastSubscriptionToken` was never recorded.
      // subscription_type=1 (frequency-based), recurring_amount = the
      // monthly fee, frequency=3 (monthly), cycles=0 (until cancelled).
      subscription_type: '1',
      recurring_amount: (amountCents / 100).toFixed(2),
      frequency: String(INTERVAL_MONTHLY),
      cycles: '0',
      custom_str1: tenantId,
      custom_str2: tier,
      custom_str3: mPaymentId,
    };

    const signature = buildPaymentSignature(data);
    const fields: PayFastField[] = Object.entries(data).map(([name, value]) => ({ name, value }));
    fields.push({ name: 'signature', value: signature });
    const query = payfastFields(fields);

    return { redirectUrl: `${BASE_URL}?${query}` };
  }

  async cancelSubscription(tenantId: string): Promise<void> {
    const row = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });
    if (!row?.payfastSubscriptionToken) return;

    // PUT /subscriptions/{token}/pause or /update with status=2 cancels.
    // PayFast uses status=2 to cancel a token.
    const res = await fetch(`${API_URL}/${row.payfastSubscriptionToken}/update`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'version': 'v1',
        'timestamp': new Date().toISOString(),
      },
      body: JSON.stringify({
        merchantId: MERCHANT_ID,
        passphrase: PASSPHRASE,
        status: 2,
      }),
    });

    // Best-effort: if PayFast is unreachable we still mark canceled locally
    // so the gate stops immediately; the operator can reconcile later.
    await db
      .update(tenants)
      .set({ planStatus: 'canceled', updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    if (!res.ok) {
      // Non-fatal: local state already canceled. Log for reconciliation.
      console.error(`[Billing] PayFast cancel API returned ${res.status} for tenant ${tenantId}; marked canceled locally.`);
    }
  }

  async verifyAndParseWebhook(req: Request): Promise<WebhookResult> {
    if (!MERCHANT_ID || !MERCHANT_KEY || !PASSPHRASE) {
      throw new Error('PayFast credentials are not configured — cannot verify webhook.');
    }

    const rawBody = await req.text();

    // Reconstruct the POST data. PayFast sends application/x-www-form-urlencoded
    // on ITN. We parse it into a record for signature verification.
    const params = new URLSearchParams(rawBody);
    const data: Record<string, string> = {};
    let signature = '';
    for (const [k, v] of Array.from(params.entries())) {
      if (k === 'signature') {
        signature = v;
      } else {
        data[k] = v;
      }
    }

    // Fail closed: no signature means reject.
    if (!signature) {
      throw new Error('PayFast ITN webhook missing signature.');
    }

    const expected = buildSignature(data, PASSPHRASE);
    if (!signaturesEqual(expected, signature)) {
      throw new Error('PayFast ITN signature mismatch — webhook rejected.');
    }

    // merchant_id must match our own — unconditionally. An ITN that omits
    // merchant_id used to skip this check; now it is rejected instead
    // (the signature already proves the sender knows the passphrase, so a
    // missing merchant_id here can only be malformed or hostile).
    if (data.merchant_id !== MERCHANT_ID) {
      throw new Error('PayFast ITN merchant_id mismatch.');
    }

    // Derive tenant + tier from m_payment_id (our trusted reference).
    const mPaymentId = data.m_payment_id ?? '';
    const [tenantId, tier] = mPaymentId.split(':');
    if (!tenantId) {
      throw new Error('PayFast ITN has no resolvable tenant.');
    }

    const pfPaymentId = data.pf_payment_id ?? '';
    const paymentStatus = (data.payment_status ?? '').toLowerCase();
    const token = data.token ?? '';
    const amountGross = parseFloat(data.amount_gross ?? '0') || 0;

    // Idempotency: a tenant+pf_payment_id we already processed is a no-op.
    // We use a lightweight check on plan_status transitions + token presence.
    const existing = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });
    if (!existing) {
      throw new Error(`PayFast ITN references unknown tenant ${tenantId}.`);
    }

    // First payment records the token and activates.
    const isFirstPayment = !existing.payfastSubscriptionToken && !!token;

    if (paymentStatus === 'complete') {
      const updates: Record<string, unknown> = {
        planStatus: 'active',
        plan: (tier as string) || existing.plan || 'starter',
        updatedAt: new Date(),
      };
      if (token) {
        updates.payfastCustomerToken = token;
        updates.payfastSubscriptionToken = token;
      }
      await db.update(tenants).set(updates).where(eq(tenants.id, tenantId));

      if (isFirstPayment) {
        console.log(`[Billing] Tenant ${tenantId} activated (${tier}) via PayFast payment ${pfPaymentId} (R${amountGross.toFixed(2)}).`);
      }
      return { ok: true, duplicate: !isFirstPayment };
    }

    if (paymentStatus === 'failed' || paymentStatus === 'cancelled') {
      // A failed/cancelled payment only dethrones a tenant that actually has
      // a subscription (or was already activated) — i.e. a failed RENEWAL.
      // A still-trialing tenant with no token is a prospect whose FIRST
      // payment attempt failed (card declined) or who aborted the PayFast
      // page (CANCELLED). Flipping them to past_due/canceled used to destroy
      // the remaining trial they had already been granted — a conversion
      // killer, not a compliance requirement.
      const isSubscriber = !!existing.payfastSubscriptionToken || existing.planStatus === 'active';
      if (!isSubscriber) {
        console.warn(
          `[Billing] Tenant ${tenantId} first payment ${paymentStatus} (PayFast ${pfPaymentId}) — trial left intact.`
        );
        return { ok: true };
      }
      const newStatus = paymentStatus === 'cancelled' ? 'canceled' : 'past_due';
      await db
        .update(tenants)
        .set({ planStatus: newStatus, updatedAt: new Date() })
        .where(and(eq(tenants.id, tenantId), sql`${tenants.planStatus} != 'canceled'`));
      console.warn(`[Billing] Tenant ${tenantId} payment ${paymentStatus} (PayFast ${pfPaymentId}).`);
      return { ok: true };
    }

    // Any other status: acknowledge but do not change state.
    return { ok: true, duplicate: true };
  }
}

let _provider: BillingProvider | null = null;

/** Shared singleton — override only in tests. */
export function getBillingProvider(): BillingProvider {
  if (!_provider) _provider = new PayFastProvider();
  return _provider;
}

export function setBillingProvider(p: BillingProvider | null): void {
  _provider = p;
}
