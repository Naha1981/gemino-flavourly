import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { approvalRequests, tenants } from '@/lib/db/schema';

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
