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
import { isOptInMessage } from '@/lib/opt-in-out';
import { verifyWebhookSignature } from '@/lib/webhook/verify';

export const runtime = 'nodejs';
export const maxDuration = 30;

// HMAC verification now lives in lib/webhook/verify.ts so the security
// boundary can be unit-tested directly. It also fails closed when
// WEBHOOK_SECRET is unset, replacing the previous
// `NODE_ENV !== 'production'` bypass — see that file for the rationale.

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
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const { waAccountId, message } = payload;

  if (!waAccountId || !message) {
    return NextResponse.json({ error: 'Missing waAccountId or message' }, { status: 400 });
  }

  // 1. Resolve Account & Tenant.
  // Always derive tenantId from wa_accounts (the source of truth in this
  // app's own database) rather than trusting payload.tenantId. The
  // operator forwards a tenantId when it has an explicit binding row for
  // the account, but that binding table is a separate mechanism that can
  // drift out of sync with wa_accounts — trusting it blindly meant a
  // stale/incorrect binding could silently attribute a customer's
  // message (and any AI reply) to the wrong tenant.
  const waAccount = await db.query.waAccounts.findFirst({
    where: eq(waAccounts.id, waAccountId),
  });
  if (!waAccount) {
    return NextResponse.json({ error: 'WhatsApp account not found' }, { status: 404 });
  }
  const tenantId = waAccount.tenantId;

  // 2. Check Global Master AI Switch + per-tenant AI toggles.
  // These three flags existed in the schema (and the global switch even
  // has a working admin UI toggle) but none of them were actually
  // enforced here — this function logged a warning and generated/sent
  // the AI reply regardless. The inbound message is still always
  // recorded below for history; only AI generation is skipped.
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

  // 3. Extract Sender & Message Text
  const remoteJid = message.key?.remoteJid || '';

  // Group chats (@g.us) and broadcast lists (status@broadcast) were being
  // treated as if they were a customer's personal phone number: split on
  // '@' with no suffix check, which turned a WhatsApp group id into a
  // "phone number", created a bogus contact record for it, and could send
  // the AI's reply into the group chat itself. Only reply to real 1:1
  // conversations.
  if (!remoteJid.endsWith('@s.whatsapp.net')) {
    return NextResponse.json({ ok: true, note: 'Ignored: not a 1:1 customer conversation (group/broadcast/status)' });
  }
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

  // Idempotency: Baileys re-emits messages.upsert on reconnect, and the
  // webhook has no retry protection of its own. Without this check, a
  // customer could receive the same AI reply two or three times whenever
  // the operator flaps or restarts. WhatsApp's own message id (msg.key.id)
  // uniquely identifies this message; if we've already recorded it for
  // this tenant, skip processing entirely rather than generating a second
  // reply.
  const waMessageId: string | undefined = message.key?.id;
  if (waMessageId) {
    const existing = await db.query.messages.findFirst({
      where: and(eq(messages.tenantId, tenantId), eq(messages.waMessageId, waMessageId)),
    });
    if (existing) {
      return NextResponse.json({ ok: true, note: 'Duplicate message (already processed)' });
    }
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

  // If user is blocklisted (opted-out via POPIA STOP), do not reply
  // unless they text START. Now routed through the same shared helper
  // as responder.ts, rather than its own separate inline check — this
  // one happened to already be an exact match, but having the rule
  // defined in two places was exactly how the responder.ts side drifted
  // into a buggier word-boundary version.
  if (contact.blocklisted && !isOptInMessage(textContent)) {
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

  // 6. Record Inbound Message.
  // The idempotency check above (step 3) has its own race window: two
  // near-simultaneous deliveries of the same WhatsApp message could
  // both pass that SELECT before either has inserted. With the new
  // partial unique index on (tenant_id, wa_message_id), the second
  // INSERT here would otherwise throw an unhandled duplicate-key error
  // — a 500 back to the operator, which would then retry (see the new
  // retry logic in operator/src/webhook/forward.ts) a message that
  // actually already succeeded. onConflictDoNothing() makes this a
  // clean no-op instead: if it didn't insert, someone else already
  // recorded this exact message, so stop here rather than generating a
  // second AI reply.
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

  // 7. If Manual Takeover is ON for this thread, or AI is suppressed at
  // the tenant/global level (checked in step 2), do not generate a reply.
  if (conversation.manualTakeover) {
    return NextResponse.json({ ok: true, note: 'Manual takeover mode is active for this thread' });
  }
  if (aiSuppressed) {
    return NextResponse.json({ ok: true, note: 'AI reply suppressed (global kill switch or tenant AI disabled)' });
  }

  // 7b. Per-conversation rate limit. Nothing previously stopped a single
  // contact (a bot, a misbehaving integration, or someone spamming a
  // tenant's number) from generating unlimited AI replies — each one a
  // real API call to Groq/Gemini and a real WhatsApp send. At 100
  // tenants, one such burst on even one thread is a real cost and abuse
  // vector. Reuses the messages table already being written to rather
  // than adding new infrastructure (Redis, etc.) — inbound messages
  // are always recorded above regardless of this check, so a burst is
  // still fully visible in the Inbox; only automated AI replies stop.
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
