import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { approvalRequests, conversations, contacts, jobs, messages } from '@/lib/db/schema';

export type ApprovalRequestRow = typeof approvalRequests.$inferSelect;

export async function listApprovalRequests(tenantId: string, status?: string): Promise<ApprovalRequestRow[]> {
  const conditions = [eq(approvalRequests.tenantId, tenantId)];
  if (status) {
    conditions.push(eq(approvalRequests.status, status as 'pending' | 'approved' | 'rejected'));
  }
  return db.select().from(approvalRequests).where(and(...conditions)).orderBy(desc(approvalRequests.createdAt));
}

export async function getApprovalRequest(tenantId: string, requestId: string): Promise<ApprovalRequestRow | null> {
  const [row] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.tenantId, tenantId))).limit(1);
  return row ?? null;
}

export async function createApprovalRequest(input: {
  tenantId: string;
  conversationId: string;
  messageText: string;
  riskLevel: 'green' | 'yellow' | 'red';
}): Promise<ApprovalRequestRow> {
  const [row] = await db.insert(approvalRequests).values({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    messageText: input.messageText,
    riskLevel: input.riskLevel,
  }).returning();
  return row;
}

export async function updateApprovalStatus(tenantId: string, requestId: string, status: 'approved' | 'rejected', approvedBy: string): Promise<ApprovalRequestRow | null> {
  const [row] = await db.update(approvalRequests).set({
    status,
    approvedBy,
    approvedAt: new Date(),
  }).where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.status, 'pending'))).returning();
  return row ?? null;
}

export async function countPendingApprovals(tenantId: string): Promise<number> {
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(approvalRequests).where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.status, 'pending')));
  return Number(row?.value ?? 0);
}

/**
 * Approve a held approval request AND hand its message to the outbox.
 *
 * Previously approving only flipped the row's status — the message that was
 * held (an AI reply containing a promotion or a refund mention) was never
 * actually sent, so "Approve" did nothing observable. Now approval resolves
 * the conversation's WhatsApp account + contact phone, enqueues a
 * `send_whatsapp` job (same outbox the manual reply and AI replies use), and
 * marks the originating outbound message row `queued` so delivery state is
 * honest too.
 *
 * Returns the job payload handed to the outbox, or null when the conversation
 * has no connected WhatsApp account or contact to send to.
 */
export async function dispatchApprovedRequest(
  tenantId: string,
  requestId: string,
  approvedBy: string
): Promise<{ approvalRequest: ApprovalRequestRow; jobId: string } | null> {
  const request = await getApprovalRequest(tenantId, requestId);
  if (!request) return null;
  if (request.status !== 'pending') return null;

  // Resolve the conversation -> contact phone + WhatsApp account.
  const [convo] = await db
    .select({
      conversationId: conversations.id,
      waAccountId: conversations.waAccountId,
      contactPhone: contacts.phone,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(and(eq(conversations.id, request.conversationId), eq(conversations.tenantId, tenantId)))
    .limit(1);

  if (!convo?.contactPhone || !convo?.waAccountId) {
    console.error(`[approvals] Cannot dispatch request ${requestId}: no connected account / contact.`);
    return null;
  }

  // Approve first (idempotent on status), then enqueue.
  const row = await updateApprovalStatus(tenantId, requestId, 'approved', approvedBy);
  if (!row) return null;

  // Reconcile the outbound message row that was held (match by conversation +
  // content), so the inbox shows queued → sent honestly instead of a held
  // message with no state.
  const [heldMessage] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(
      eq(messages.conversationId, request.conversationId),
      eq(messages.content, request.messageText),
      eq(messages.tenantId, tenantId),
      eq(messages.isAIGenerated, true)
    ))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const messageId = heldMessage?.id;
  if (messageId) {
    await db
      .update(messages)
      .set({ deliveryStatus: 'queued', deliveryError: null })
      .where(eq(messages.id, messageId));
  }

  const [job] = await db
    .insert(jobs)
    .values({
      tenantId,
      type: 'send_whatsapp',
      payload: {
        waAccountId: convo.waAccountId,
        to: convo.contactPhone,
        text: request.messageText,
        messageId,
      },
      status: 'pending',
      maxAttempts: 5,
      nextRunAt: new Date(),
    })
    .returning();

  return { approvalRequest: row, jobId: job.id };
}
