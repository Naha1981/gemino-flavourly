import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db, initDb } from '@/lib/db';
import { waAccounts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  await initDb();
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const [account] = await db.select().from(waAccounts).where(eq(waAccounts.tenantId, tenant.id)).limit(1);
  if (!account) return NextResponse.json({ error: 'No WhatsApp account found.' }, { status: 404 });

  return NextResponse.json({
    isConnected: account.isConnected,
    phoneNumber: account.phoneNumber,
    qrCode: account.qrCode,
  });
}
