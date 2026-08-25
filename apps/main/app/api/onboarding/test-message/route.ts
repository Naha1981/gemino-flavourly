import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { waAccounts, jobs } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { canSendAutomatedMessages } from '@/lib/billing/gate-evaluate';

export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding/test-message — send a test WhatsApp message to the
 * tenant's own number via their linked account. Gated by billing (except the
 * test uses the operator directly; still respects plan status).
 */
export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (!phone) {
    return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
  }

  // Billing gate applies even to test messages (they are a send).
  if (!(await canSendAutomatedMessages(tenant.id))) {
    return NextResponse.json({ error: 'Billing inactive — renew to resume AI' }, { status: 402 });
  }

  const waAccount = await db.query.waAccounts.findFirst({
    where: and(eq(waAccounts.tenantId, tenant.id), eq(waAccounts.isConnected, true)),
  });

  const text = `Hi! This is a test message from Gemino AI on behalf of ${tenant.name || 'your restaurant'}. Your WhatsApp integration is working.`;
  await db.insert(jobs).values({
    tenantId: tenant.id,
    type: 'send_whatsapp',
    payload: {
      waAccountId: waAccount?.id ?? null,
      to: phone,
      text,
      testMessage: true,
    },
    status: 'pending',
    nextRunAt: new Date(),
  });

  return NextResponse.json({ ok: true, sent: true });
}
