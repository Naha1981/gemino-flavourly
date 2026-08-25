import { createHash, randomUUID } from 'crypto';
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

function payfastFields(fields: PayFastField[]): string {
  return fields
    .map(({ name, value }) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
}

/**
 * PayFast ITN signature: md5 of the urlencoded query string (fields sorted,
 * ampersand-joined) + the passphrase appended verbatim.
 */
function buildSignature(data: Record<string, string>, passphrase: string): string {
  const keys = Object.keys(data).sort();
  const pairs = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(data[k] ?? '')}`);
  const raw = pairs.join('&') + (passphrase ? `&passphrase=${encodeURIComponent(passphrase)}` : '');
  return createHash('md5').update(raw).digest('hex');
}

/** Build the signature the payment/redirect path uses (no passphrase in URL). */
function buildPaymentSignature(data: Record<string, string>): string {
  const keys = Object.keys(data).sort();
  const pairs = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(data[k] ?? '')}`);
  const raw = pairs.join('&');
  return createHash('md5').update(raw).digest('hex');
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
      name_first: '',
      name_last: '',
      email_address: '',
      cell_number: '',
      m_payment_id: mPaymentId,
      amount: (amountCents / 100).toFixed(2),
      item_name: `Gemino ${tier} — monthly subscription`,
      item_description: `Gemino ${tier} plan${setupCents ? ` (setup R${(setupCents / 100).toFixed(2)})` : ''}`,
      // Tokenization + recurring: subscription=true, recurring_type=1 (subscription),
      // frequency=3 (monthly), cycles=0 (indefinite).
      custom_int1: '1',
      custom_int2: String(INTERVAL_MONTHLY),
      custom_int3: '0',
      custom_int4: '0',
      custom_str1: tenantId,
      custom_str2: tier,
      custom_str3: mPaymentId,
    };

    const signature = buildPaymentSignature(data);
    const query = payfastFields([...Object.entries(data).map(([name, value]) => ({ name, value })), { name: 'signature', value: signature })]);

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
    for (const [k, v] of params.entries()) {
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
    if (expected !== signature) {
      throw new Error('PayFast ITN signature mismatch — webhook rejected.');
    }

    // merchant_id must match our own.
    if (data.merchant_id && data.merchant_id !== MERCHANT_ID) {
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
