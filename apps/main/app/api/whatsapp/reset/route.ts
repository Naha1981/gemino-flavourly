import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { ensureWaAccount } from '@/lib/whatsapp/ensure-account';
import { operatorClient } from '@/lib/operator-client';

export const runtime = 'nodejs';

export async function POST() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const account = await ensureWaAccount(tenant.id);
  if (!account) return NextResponse.json({ error: 'WhatsApp account is unavailable.' }, { status: 500 });

  try {
    await operatorClient.reset(tenant.id, account.id);
    return NextResponse.json({ ok: true, status: 'unlinked' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not reset WhatsApp.' }, { status: 502 });
  }
}
