import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { ensureWaAccount } from '@/lib/whatsapp/ensure-account';
import { operatorClient } from '@/lib/operator-client';

export const runtime = 'nodejs';
export const maxDuration = 20;

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const account = await ensureWaAccount(tenant.id);
  if (!account) return NextResponse.json({ error: 'WhatsApp account is unavailable.' }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const phoneNumber = typeof body?.phoneNumber === 'string' ? body.phoneNumber.trim() : '';
  if (!/^\d{8,15}$/.test(phoneNumber)) {
    return NextResponse.json({ error: 'Enter the WhatsApp phone number in international format using digits only (8–15 digits).' }, { status: 400 });
  }

  try {
    const pairing = await operatorClient.requestPairingCode(tenant.id, account.id, phoneNumber);
    return NextResponse.json(pairing, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not request a pairing code.' }, { status: 502 });
  }
}
