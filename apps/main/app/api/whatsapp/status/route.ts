import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { ensureWaAccount } from '@/lib/whatsapp/ensure-account';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  // Auto-provisions the row for tenants created before the row-per-tenant
  // invariant existed — without this, the entire linking flow 404'd for
  // them and no QR could ever be displayed (2026-08-31 gate finding).
  const account = await ensureWaAccount(tenant.id);
  if (!account) {
    return NextResponse.json({ error: 'Could not provision WhatsApp account row.' }, { status: 500 });
  }

  return NextResponse.json({
    isConnected: account.isConnected,
    phoneNumber: account.phoneNumber,
    qrCode: account.qrCode,
    status: account.status ?? 'unlinked',
  });
}
