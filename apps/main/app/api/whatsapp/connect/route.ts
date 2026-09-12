import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { ensureWaAccount } from '@/lib/whatsapp/ensure-account';
import { operatorClient } from '@/lib/operator-client';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Start the signed-in tenant's WhatsApp account on the central NahaLabs Operator. */
export async function POST() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const account = await ensureWaAccount(tenant.id);
  if (!account) {
    return NextResponse.json({ error: 'Could not provision the WhatsApp account record.' }, { status: 500 });
  }

  try {
    const result = await operatorClient.connect(tenant.id, account.id);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Could not start the WhatsApp connection.' }, { status: 502 });
    }

    const status = await operatorClient.getStatus(tenant.id, account.id, 8_000);
    return NextResponse.json({
      ok: true,
      isConnected: status?.isConnected ?? result.isConnected ?? false,
      qrCode: status?.qrCode ?? result.qrCode ?? null,
      phoneNumber: status?.phoneNumber ?? result.phoneNumber ?? null,
    }, { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Could not start the WhatsApp connection.',
    }, { status: 502 });
  }
}
