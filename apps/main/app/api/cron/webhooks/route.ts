import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { deliverWebhookBatch } from '@/lib/webhooks/outbound';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;
  try {
    return NextResponse.json({ ok: true, ...(await deliverWebhookBatch()) });
  } catch (error) {
    console.error('[Webhook Delivery] sweep failed', error);
    return NextResponse.json({ ok: false, error: 'Webhook delivery failed' }, { status: 500 });
  }
}
