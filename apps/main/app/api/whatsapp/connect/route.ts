import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { waAccounts, tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { operatorClient } from '@/lib/operator-client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { tenantId } = await req.json();

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    // Find or create wa_account for this tenant
    let waAccount = await db.query.waAccounts.findFirst({
      where: eq(waAccounts.tenantId, tenantId),
    });

    if (!waAccount) {
      const [newAccount] = await db
        .insert(waAccounts)
        .values({
          tenantId,
          isConnected: false,
          status: 'connecting',
        })
        .returning();
      waAccount = newAccount;
    }

    // Command Operator to start socket
    const opResult = await operatorClient.startSocket(waAccount.id);

    if (!opResult.success) {
      return NextResponse.json(
        { error: opResult.error || 'Failed to start WhatsApp socket on operator engine' },
        { status: 502 }
      );
    }

    // Return the current state (QR code string or connected status)
    return NextResponse.json({
      success: true,
      waAccountId: waAccount.id,
      isConnected: opResult.isConnected,
      qrCode: opResult.qrCode,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
