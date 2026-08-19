import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { waAccounts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const [account] = await db.select().from(waAccounts).where(eq(waAccounts.tenantId, tenant.id)).limit(1);
  if (!account) return NextResponse.json({ error: 'No WhatsApp account found.' }, { status: 404 });

  const resp = await fetch(`${process.env.OPERATOR_URL}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.OPERATOR_API_KEY!,
    },
    body: JSON.stringify({ waAccountId: account.id }),
    cache: 'no-store',
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return NextResponse.json({ error: data?.error || 'WhatsApp engine unreachable.' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
