import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { conversations, contacts, messages, jobs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { operatorClient } from '@/lib/operator-client';
import {
  findDispatchBlocker,
  resolveDispatchOutcome,
  dispatchHttpStatus,
} from '@/lib/messaging/dispatch';

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

  // 4. Try direct dispatch via Operator, falling back to the outbox.
  //
  // operatorClient.sendMessage() never throws — every failure path inside
  // it is caught and returned as { success: false, error } — so the real
  // result must be inspected rather than assumed.
  //
  // Critically, the whole block used to be gated on `if
  // (convo.waAccountId)`. That column is nullable, so when it was NULL
  // nothing was sent, nothing was queued, and the route still returned
  // { ok: true }: a silently dropped message. Dispatch is now resolved
  // explicitly and an undispatchable message is reported as a failure.
  const blocker = findDispatchBlocker(convo.waAccountId);

  let directSendSucceeded = false;
  let queuedForRetry = false;
  let dispatchError: string | undefined;

  if (!blocker && convo.waAccountId) {
    const result = await operatorClient.sendMessage(
      tenant.id,
      convo.waAccountId,
      convo.contactPhone,
      content.trim()
    );
    directSendSucceeded = result.success;
    if (!result.success) {
      dispatchError = result.error;
      // Operator unreachable or refused: hand off to the outbox, which
      // retries with backoff. Delivery is pending, not lost.
      try {
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
          nextRunAt: new Date(),
        });
        queuedForRetry = true;
      } catch (err) {
        // If even queueing fails the message really is lost, and the
        // caller must be told so.
        console.error('[messages] Failed to queue outbound message for retry', err);
        queuedForRetry = false;
      }
    }
  }

  const outcome = resolveDispatchOutcome({
    blocker,
    directSendSucceeded,
    queuedForRetry,
    error: dispatchError,
  });

  // 5. Record the delivery state on the message row so the inbox can show
  // staff what actually happened instead of rendering every reply as sent.
  const [savedMessage] = await db
    .update(messages)
    .set({ deliveryStatus: outcome.status, deliveryError: outcome.error ?? null })
    .where(eq(messages.id, newMessage.id))
    .returning();

  return NextResponse.json(
    {
      ok: outcome.accepted,
      message: savedMessage ?? newMessage,
      deliveryStatus: outcome.status,
      ...(outcome.error ? { error: outcome.error } : {}),
    },
    { status: dispatchHttpStatus(outcome) }
  );
}
