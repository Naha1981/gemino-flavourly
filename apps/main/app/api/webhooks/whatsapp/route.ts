import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import {
  tenants,
  waAccounts,
  contacts,
  conversations,
  messages,
  jobs,
  systemSettings,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { processInboundAIResponse } from '@/lib/ai/responder';

export const runtime = 'nodejs';
export const maxDuration = 30;

function verifyHmacSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // dev fallback if not configured
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function enqueueOutboundMessage(tenantId: string, waAccountId: string, to: string, text: string) {
  await db.insert(jobs).values({
    tenantId,
    type: 'send_whatsapp',
    payload: { waAccountId, to, text },
    status: 'pending',
    nextRunAt: new Date(),
  });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-webhook-signature');

  // Verify HMAC-SHA256 signature
  if (!verifyHmacSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const { waAccountId, message, tenantId: payloadTenantId } = payload;

  if (!waAccountId || !message) {
    return NextResponse.json({ error: 'Missing waAccountId or message' }, { status: 400 });
  }

  // 1. Resolve Account & Tenant
  let tenantId = payloadTenantId;
  if (!tenantId) {
    const waAccount = await db.query.waAccounts.findFirst({
      where: eq(waAccounts.id, waAccountId),
    });
    if (!waAccount) {
      return NextResponse.json({ error: 'WhatsApp account not found' }, { status: 404 });
    }
    tenantId = waAccount.tenantId;
  }

  // 2. Check Global Master AI Switch
  const settings = await db.query.systemSettings.findFirst();
  if (settings && !settings.masterAiSwitch) {
    // Log message but bypass AI response
    console.warn('[Global AI Master Switch] AI is globally turned off.');
  }

  // 3. Extract Sender & Message Text
  const remoteJid = message.key?.remoteJid || '';
  const fromPhone = remoteJid.split('@')[0];
  const pushName = message.pushName || 'Valued Customer';
  const textContent =
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    '';

  if (!fromPhone || !textContent) {
    return NextResponse.json({ ok: true, note: 'Empty or unsupported message type' });
  }

  // 4. Upsert Contact
  let contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.tenantId, tenantId), eq(contacts.phone, fromPhone)),
  });

  if (!contact) {
    const [newContact] = await db
      .insert(contacts)
      .values({
        tenantId,
        phone: fromPhone,
        name: pushName,
        blocklisted: false,
        vip: false,
      })
      .returning();
    contact = newContact;
  } else if (contact.name !== pushName && pushName !== 'Valued Customer') {
    await db.update(contacts).set({ name: pushName }).where(eq(contacts.id, contact.id));
  }

  // If user is blocklisted (opted-out via POPIA STOP), do not reply unless they text START
  if (contact.blocklisted && textContent.trim().toLowerCase() !== 'start') {
    return NextResponse.json({ ok: true, note: 'User is blocklisted / unsubscribed' });
  }

  // 5. Upsert Conversation
  let conversation = await db.query.conversations.findFirst({
    where: and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contact.id)),
  });

  if (!conversation) {
    const [newConv] = await db
      .insert(conversations)
      .values({
        tenantId,
        contactId: contact.id,
        waAccountId,
        lastMessageAt: new Date(),
      })
      .returning();
    conversation = newConv;
  } else {
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(), isResolved: false })
      .where(eq(conversations.id, conversation.id));
  }

  // 6. Record Inbound Message
  await db.insert(messages).values({
    tenantId,
    conversationId: conversation.id,
    direction: 'inbound',
    content: textContent,
    isAIGenerated: false,
  });

  // 7. If Manual Takeover is ON, do not generate AI reply
  if (conversation.manualTakeover) {
    return NextResponse.json({ ok: true, note: 'Manual takeover mode is active for this thread' });
  }

  // 8. Generate & Enqueue AI Reply
  const aiReply = await processInboundAIResponse({
    tenantId,
    waAccountId,
    phone: fromPhone,
    senderName: pushName,
    text: textContent,
    conversationId: conversation.id,
    contactId: contact.id,
  });

  if (aiReply) {
    // Record Outbound Message in DB
    await db.insert(messages).values({
      tenantId,
      conversationId: conversation.id,
      direction: 'outbound',
      content: aiReply,
      isAIGenerated: true,
    });

    // Enqueue to Outbox table for immediate delivery
    await enqueueOutboundMessage(tenantId, waAccountId, fromPhone, aiReply);
  }

  return NextResponse.json({ ok: true });
}
