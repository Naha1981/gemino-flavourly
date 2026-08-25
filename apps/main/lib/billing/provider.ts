/**
 * Payment provider abstraction.
 *
 * Stripe is NOT usable in South Africa for this product, so the reference
 * implementation is PayFast (tokenized recurring billing via ITN webhooks).
 * The interface is provider-agnostic so a second adapter (Stripe, Yoco, etc.)
 * can be added later without touching the routes or the gate. No Stripe code
 * exists today — that is intentional YAGNI.
 */

export type PlanTier = 'starter' | 'casual' | 'premium' | 'signature' | 'group';

export interface CheckoutRequest {
  tenantId: string;
  tier: PlanTier;
  /** Where to send the user after a successful payment. */
  returnUrl: string;
}

export interface CheckoutResult {
  /** URL the browser should redirect to (PayFast payment page). */
  redirectUrl: string;
}

export interface WebhookResult {
  ok: boolean;
  /** True when the event was a no-op (already processed / unrecognised). */
  duplicate?: boolean;
}

export interface BillingProvider {
  createSubscriptionCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  cancelSubscription(tenantId: string): Promise<void>;
  /**
   * Verify and parse an incoming webhook request. Returns the parsed result
   * or throws if signature verification fails. Implementations MUST fail
   * closed: any doubt about authenticity throws.
   */
  verifyAndParseWebhook(req: Request): Promise<WebhookResult>;
}

export const PLAN_TIERS: PlanTier[] = ['starter', 'casual', 'premium', 'signature', 'group'];

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === 'string' && PLAN_TIERS.includes(value as PlanTier);
}
