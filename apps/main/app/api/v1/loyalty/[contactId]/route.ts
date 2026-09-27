import { NextResponse } from 'next/server';
import { authenticatePublicApi } from '@/lib/api/public-api';
import { db } from '@/lib/db';
import { contacts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function GET(req: Request, ctx: { params: Promise<{ contactId: string }> }) {
  try {
    const auth = await authenticatePublicApi(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { contactId } = await ctx.params;
    const [contact] = await db.select({ id: contacts.id, points: contacts.loyaltyPoints, vip: contacts.vip }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, auth.tenantId))).limit(1);
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: contact });
  } catch (error) {
    if (error instanceof Error && error.message === 'RATE_LIMITED') return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    return NextResponse.json({ error: 'API error' }, { status: 500 });
  }
}
