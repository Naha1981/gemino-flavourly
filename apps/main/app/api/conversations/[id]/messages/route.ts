import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { conversations, contacts, messages, jobs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { operatorClient } from '@/lib/operator-client';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const conversationId = params.id;
  const { content } = await req.json();

  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'Message content is required' }, { status: 400 });
  }

  // 1. Fetch conversation & contact
  const [convo] = await db
    .select({
      id: conversations.id,
      tenantId: conversations.tenantId,
      waAccountId: conversations.waAccountId,
      contactPhone: contacts.phone,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenant.id)))
    .limit(1);

  if (!convo) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  // 2. Insert message into messages table
  const [newMessage] = await db
    .insert(messages)
    .values({
      tenantId: tenant.id,
      conversationId: convo.id,
      direction: 'outbound',
      content: content.trim(),
      isAIGenerated: false,
    })
    .returning();

  // 3. Mark conversation as manual takeover & update timestamp
  await db
    .update(conversations)
    .set({
      manualTakeover: true,
      lastMessageAt: new Date(),
    })
    .where(eq(conversations.id, convo.id));

  // 4. Try direct dispatch via Operator, or fallback to Outbox jobs
  let sentDirectly = false;
  if (convo.waAccountId) {
    try {
      await operatorClient.sendMessage(convo.waAccountId, convo.contactPhone, content.trim());
      sentDirectly = true;
    } catch {
      // Operator fallback
    }
  }

  if (!sentDirectly && convo.waAccountId) {
    await db.insert(jobs).values({
      tenantId: tenant.id,
      type: 'send_whatsapp',
      payload: {
        waAccountId: convo.waAccountId,
        to: convo.contactPhone,
        text: content.trim(),
        messageId: newMessage.id,
      },
      status: 'pending',
    });
  }

  return NextResponse.json({ ok: true, message: newMessage });
}
