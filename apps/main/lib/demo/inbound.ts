import { randomUUID } from 'crypto';
import { db, initDb } from '@/lib/db';
import { contacts, conversations, messages, waAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getOrCreateTenant } from '@/lib/tenant';
import { processInboundAIResponse } from '@/lib/ai/responder';
import { enqueueWhatsApp } from '@/lib/outbox';
import { isOptInCommand } from '@/lib/ai/popia';

export async function processDemoInbound(opts: { text: string; phone?: string; name?: string }) {
  await initDb();
  const tenant = await getOrCreateTenant();
  if (!tenant) throw new Error('No tenant');

  const [wa] = await db.select().from(waAccounts).where(eq(waAccounts.tenantId, tenant.id)).limit(1);

  const phone = opts.phone || '27820001111';
  const name = opts.name || 'Walk-in guest';

  let contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.tenantId, tenant.id), eq(contacts.phone, phone)),
  });
  if (!contact) {
    const [c] = await db
      .insert(contacts)
      .values({ tenantId: tenant.id, phone, name })
      .returning();
    contact = c;
  }

  if (contact.blocklisted && !isOptInCommand(opts.text)) {
    return null;
  }

  let conversation = await db.query.conversations.findFirst({
    where: and(eq(conversations.tenantId, tenant.id), eq(conversations.contactId, contact.id)),
  });
  if (!conversation) {
    const [c] = await db
      .insert(conversations)
      .values({
        tenantId: tenant.id,
        contactId: contact.id,
        waAccountId: wa?.id,
        lastMessageAt: new Date(),
      })
      .returning();
    conversation = c;
  } else {
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(), isResolved: false })
      .where(eq(conversations.id, conversation.id));
  }

  await db.insert(messages).values({
    tenantId: tenant.id,
    conversationId: conversation.id,
    direction: 'inbound',
    content: opts.text,
    isAIGenerated: false,
    waMessageId: `demo-${randomUUID()}`,
  });

  if (conversation.manualTakeover || !tenant.aiEnabled || tenant.manualMode) {
    return conversation.id;
  }

  const reply = await processInboundAIResponse({
    tenantId: tenant.id,
    waAccountId: wa?.id || '',
    phone,
    senderName: contact.name || name,
    text: opts.text,
    conversationId: conversation.id,
    contactId: contact.id,
  });

  if (reply) {
    await db.insert(messages).values({
      tenantId: tenant.id,
      conversationId: conversation.id,
      direction: 'outbound',
      content: reply,
      isAIGenerated: true,
    });
    if (wa?.id) {
      await enqueueWhatsApp({
        tenantId: tenant.id,
        waAccountId: wa.id,
        to: phone,
        text: reply,
      });
    }
  }

  return conversation.id;
}
