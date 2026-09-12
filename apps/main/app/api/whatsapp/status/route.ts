import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { ensureWaAccount } from '@/lib/whatsapp/ensure-account';
import { operatorClient } from '@/lib/operator-client';

export const dynamic = 'force-dynamic';

const OPERATOR_HEALTH_TTL_MS = 5_000;
let operatorHealthCache: { at: number; ok: boolean } | null = null;

async function checkOperatorOnline(): Promise<boolean> {
  const now = Date.now();
  if (operatorHealthCache && now - operatorHealthCache.at < OPERATOR_HEALTH_TTL_MS) {
    return operatorHealthCache.ok;
  }
  const ok = await operatorClient.checkHealth();
  operatorHealthCache = { at: now, ok };
  return ok;
}

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const account = await ensureWaAccount(tenant.id);
  if (!account) {
    return NextResponse.json({ error: 'Could not provision the WhatsApp account record.' }, { status: 500 });
  }

  try {
    const live = await operatorClient.getStatus(tenant.id, account.id, 8_000);
    if (live) {
      return NextResponse.json({
        isConnected: live.isConnected,
        phoneNumber: live.phoneNumber ?? null,
        qrCode: live.isConnected ? null : (live.qrCode ?? null),
        status: live.status,
        operatorOnline: true,
      }, { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } });
    }
  } catch {
    // Fall through to a clear offline response. The UI keeps retrying.
  }

  const operatorOnline = await checkOperatorOnline();
  return NextResponse.json({
    isConnected: false,
    phoneNumber: null,
    qrCode: null,
    status: account.status ?? 'unlinked',
    operatorOnline,
  }, { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } });
}
