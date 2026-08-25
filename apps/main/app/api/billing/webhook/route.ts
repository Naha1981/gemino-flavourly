import { NextRequest, NextResponse } from 'next/server';
import { getBillingProvider } from '@/lib/billing/payfast';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/webhook — PayFast ITN (Instant Transaction Notification).
 *
 * NO Clerk auth: PayFast POSTs here directly. Authentication is via the MD5
 * signature (with passphrase) that verifyAndParseWebhook validates. It fails
 * closed — any verification failure throws and we return 400.
 *
 * Successful recurring payment → plan_status='active' + token recorded.
 * Failure / cancellation → 'past_due' / 'canceled'.
 * Returns 200 fast and idempotently.
 */
export async function POST(req: NextRequest) {
  try {
    const provider = getBillingProvider();
    const result = await provider.verifyAndParseWebhook(req);
    return NextResponse.json({ ok: true, duplicate: result.duplicate === true });
  } catch (err: any) {
    // Signature mismatch or malformed payload. Return 400 (not 500) so PayFast
    // does not keep retrying a payload we will never accept.
    console.error(`[Billing Webhook] Rejected: ${err.message}`);
    return NextResponse.json({ error: 'Rejected', reason: err.message }, { status: 400 });
  }
}
