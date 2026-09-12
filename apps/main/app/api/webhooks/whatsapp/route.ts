import { NextRequest, NextResponse } from 'next/server';
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
import { and, eq, gte, count } from 'drizzle-orm';
import { processInboundAIResponse } from '@/lib/ai/responder';
import { isOptInMessage, isOptOutMessage } from '@/lib/opt-in-out';
import { verifyWebhookSignature } from '@/lib/webhook/verify';
import { resolveGeminoTenantFromCentralAccount } from '@/lib/whatsapp/central-operator';
import { ensureWaAccount } from '@/lib/whatsapp/ensure-account';
import { isReactivationBookingReply } from '@/lib/customer/reactivation';
import { markLatestCampaignResponded } from '@/lib/customer/reactivation-store';
import { processFirstMessageVip } from '@/lib/customer/vip-recognition';
import { drizzleVipRecognitionStore } from '@/lib/customer/vip-store';
import { classifyMessageRisk, decideApprovalAction } from '@/lib/operations/approval-classifier';
import { createApprovalRequest } from '@/lib/operations/approval-request-store';

export const runtime = 'nodejs';
export const maxDuration = 30;

async function enqueueOutboundMessage(
  tenantId: string,
  localWaAccountId: string,
  to: string,
  text: string,
  messageId?: string
) {
  await db.insert(jobs).values({
    tenantId,
    type: 'send_whatsapp',
    payload: { waAccountId: localWaAccountId, to, text, messageId },
    status: 'pending',
    nextRunAt: new Date(),
  });
}

/**
 * Business-side webhook for the central NahaLabs WhatsApp Operator.
 *
 * The Operator sends a signed schemaVersion=1 event whose `data` contains a
 * normalized WhatsApp message. Gemino derives the tenant only from its own
 * wa_account_bindings mapping; payload tenantId/appId values are never used
 * as authorization.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-webhook-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const { waAccountId, event, data } = payload;
  if (!waAccountId || !event) {
    return NextResponse.json({ error: 'Missing waAccountId or event' }, { status: 400 });
  }

  // Gemino only needs message events for the AI/customer pipeline. Other
  // Operator events (connection, receipts, presence, contacts, calls, etc.)
  // are accepted so the central Operator never retries them indefinitely.
  if (event !== 'message') {
    return NextResponse.json({ ok: true, ignoredEvent: event });
  }

  const centralTenantId = await resolveGeminoTenantFromCentralAccount(String(waAccountId));
  if (!centralTenantId) {
    return NextResponse.json({ error: 'WhatsApp account is not bound to Gemino' }, { status: 403 });
  }

  // Resolve the Gemino-side account using the trusted tenant mapping. The
  // central Operator account id is deliberately not treated as the Gemino DB
  // wa_accounts primary key.
  const localWaAccount = await ensureWaAccount(centralTenantId);
  if (!localWaAccount) {
    return NextResponse.json({ error: 'Gemino WhatsApp account mapping is unavailable' }, { status: 500 });
  }

  const tenantId = localWaAccount.tenantId;
  const message = data ?? {};

  // Never feed our own outbound messages back through the AI responder.
  if (message.fromMe === true) {
    return NextResponse.json({ ok: true, note: 'Ignored own outbound message' });
  }

  const chatId = typeof message.chatId === 'string' ? message.chatId : '';
  if (!chatId.endsWith('@s.whatsapp.net')) {
    return NextResponse.json({ ok: true, note: 'Ignored: not a 1:1 customer conversation (group/broadcast/status)' });
  }

  const fromPhone = chatId.split('@')[0];
  const pushName = typeof message.pushName === 'string' && message.pushName ? message.pushName : 'Valued Customer';
  const textContent = typeof message.text === 'string' ? message.text : '';
  const waMessageId = typeof message.messageId === 'string' && message.messageId ? message.messageId : undefined;

  if (!fromPhone || !textContent) {
    return NextResponse.json({ ok: true, note: 'Empty or unsupported message type' });
  }

  if (waMessageId) {
    const existing = await db.query.messages.findFirst({
      where: and(eq(messages.tenantId, tenantId), eq(messages.waMessageId, waMessageId)),
    });
    if (existing) {
      return NextResponse.json({ ok: true, note: 'Duplicate message (already processed)' });
    }
  }

  const settings = await db.query.systemSettings.findFirst();
  const globalAiOff = !!settings && !settings.masterAiSwitch;
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  const tenantAiOff = !tenant || !tenant.aiEnabled || tenant.manualMode;
  const aiSuppressed = globalAiOff || tenantAiOff;

  if (globalAiOff) {
    console.warn('[Global AI Master Switch] AI is globally turned off — skipping AI reply.');
  } else if (tenantAiOff) {
    console.warn(`[Tenant AI Disabled] tenant=${tenantId} aiEnabled=${tenant?.aiEnabled} manualMode=${tenant?.manualMode} — skipping AI reply.`);
  }

  let contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.tenantId, tenantId), eq(contacts.phone, fromPhone)),
  });

  if (!contact) {
    const [newContact] = await db
      .insert(contacts)
      .values({ tenantId, phone: fromPhone, name: pushName, blocklisted: false, vip: false })
      .returning();
    contact = newContact;
  } else if (contact.name !== pushName && pushName !== 'Valued Customer') {
    await db.update(contacts).set({ name: pushName }).where(eq(contacts.id, contact.id));
  }

  if (contact.blocklisted && !isOptInMessage(textContent)) {
    return NextResponse.json({ ok: true, note: 'User is blocklisted / unsubscribed' });
  }

  if (isOptOutMessage(textContent)) {
    await db.update(contacts).set({ blocklisted: true }).where(eq(contacts.id, contact.id));
    contact.blocklisted = true;
    console.log(`[POPIA] ${fromPhone} opted out (tenant ${tenantId}) — blocklisted.`);
  } else if (isOptInMessage(textContent)) {
    await db.update(contacts).set({ blocklisted: false }).where(eq(contacts.id, contact.id));
    contact.blocklisted = false;
    console.log(`[POPIA] ${fromPhone} opted back in (tenant ${tenantId}).`);
  }

  let isNewConversation = false;
  let conversation = await db.query.conversations.findFirst({
    where: and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contact.id)),
  });

  if (!conversation) {
    const [newConv] = await db
      .insert(conversations)
      .values({
        tenantId,
        contactId: contact.id,
        waAccountId: localWaAccount.id,
        lastMessageAt: new Date(),
      })
      .returning();
    conversation = newConv;
    isNewConversation = true;
  } else {
    await db.update(conversations).set({ lastMessageAt: new Date(), isResolved: false }).where(eq(conversations.id, conversation.id));
  }

  const [insertedMessage] = await db
    .insert(messages)
    .values({
      tenantId,
      conversationId: conversation.id,
      direction: 'inbound',
      content: textContent,
      isAIGenerated: false,
      waMessageId,
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });

  if (!insertedMessage && waMessageId) {
    return NextResponse.json({ ok: true, note: 'Duplicate message (race on concurrent delivery)' });
  }

  if (isNewConversation) {
    try {
      const processed = await processFirstMessageVip(drizzleVipRecognitionStore, {
        tenantId,
        customerPhone: fromPhone,
        conversationId: conversation.id,
      });
      if (processed) {
        console.log(`[VIP] Alert raised for ${fromPhone} · ${processed.alert.customerName ?? 'Guest'} (${processed.alert.totalVisits} visits)`);
      }
    } catch (err) {
      console.error(`[VIP] Failed to process VIP recognition for ${fromPhone}`, err);
    }
  }

  try {
    const campaign = await markLatestCampaignResponded(tenantId, fromPhone);
    if (campaign) {
      const bookingIntent = isReactivationBookingReply(textContent) ? ' (booking intent)' : '';
      console.log(`[Reactivation] Campaign ${campaign.id} marked responded by ${fromPhone}${bookingIntent}`);
    }
  } catch (err) {
    console.error(`[Reactivation] Failed to attribute response from ${fromPhone}`, err);
  }

  if (conversation.manualTakeover) {
    return NextResponse.json({ ok: true, note: 'Manual takeover mode is active for this thread' });
  }
  if (aiSuppressed) {
    return NextResponse.json({ ok: true, note: 'AI reply suppressed (global kill switch or tenant AI disabled)' });
  }

  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX_INBOUND = 10;
  const [{ value: recentInboundCount }] = await db
    .select({ value: count() })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        eq(messages.direction, 'inbound'),
        gte(messages.createdAt, new Date(Date.now() - RATE_LIMIT_WINDOW_MS))
      )
    );
  if (recentInboundCount > RATE_LIMIT_MAX_INBOUND) {
    console.warn(`[RateLimit] Conversation ${conversation.id} exceeded ${RATE_LIMIT_MAX_INBOUND} inbound messages/min — suppressing AI reply.`);
    return NextResponse.json({ ok: true, note: 'Rate limited: too many messages in a short window' });
  }

  const aiReply = await processInboundAIResponse({
    tenantId,
    waAccountId: localWaAccount.id,
    phone: fromPhone,
    senderName: pushName,
    text: textContent,
    conversationId: conversation.id,
    contactId: contact.id,
  });

  if (aiReply) {
    const risk = classifyMessageRisk(aiReply);
    const decision = decideApprovalAction(risk);

    const [outboundMessage] = await db
      .insert(messages)
      .values({
        tenantId,
        conversationId: conversation.id,
        direction: 'outbound',
        content: aiReply,
        isAIGenerated: true,
        deliveryStatus: decision.outcome === 'auto_send' ? 'queued' : null,
        deliveryError: decision.outcome === 'require_approval' ? 'Held for owner approval (approval workflow)' : null,
      })
      .returning();

    if (decision.outcome === 'auto_send') {
      await enqueueOutboundMessage(tenantId, localWaAccount.id, fromPhone, aiReply, outboundMessage.id);
    } else {
      await createApprovalRequest({
        tenantId,
        conversationId: conversation.id,
        messageText: aiReply,
        riskLevel: decision.riskLevel,
      }).catch((err) => console.error('[webhook] failed to create approval request for held message', err));
      console.warn(`[Approval] AI reply held for tenant ${tenantId} (risk=${decision.riskLevel}). Message recorded but NOT sent; owner must approve.`);
    }
  }

  return NextResponse.json({ ok: true });
}
