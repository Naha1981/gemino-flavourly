import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { ensureWaAccount } from '@/lib/whatsapp/ensure-account';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  // Auto-provisions the row for tenants created before the row-per-tenant
  // invariant existed — /connect used to 404 for them, so linking could
  // never even start (2026-08-31 gate finding).
  const account = await ensureWaAccount(tenant.id);
  if (!account) {
    return NextResponse.json({ error: 'Could not provision WhatsApp account row.' }, { status: 500 });
  }

  const resp = await fetch(`${process.env.OPERATOR_URL}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.OPERATOR_API_KEY!,
    },
    body: JSON.stringify({ waAccountId: account.id, tenantId: tenant.id }),
    cache: 'no-store',
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return NextResponse.json({ error: data?.error || 'WhatsApp engine unreachable.' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
