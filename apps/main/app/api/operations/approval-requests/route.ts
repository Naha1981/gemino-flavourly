import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  countPendingApprovals,
  createApprovalRequest,
  listApprovalRequests,
} from '@/lib/operations/approval-request-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status')?.trim() ?? undefined;

  const rows = await listApprovalRequests(tenant.id, status);
  const pendingCount = await countPendingApprovals(tenant.id);

  return NextResponse.json({ approvalRequests: rows, pendingCount });
}

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { conversation_id?: unknown; message_text?: unknown; risk_level?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id.trim() : '';
  const messageText = typeof body.message_text === 'string' ? body.message_text.trim() : '';
  const riskLevel = typeof body.risk_level === 'string' ? body.risk_level.trim() : '';

  if (!conversationId || !messageText || !riskLevel) {
    return NextResponse.json({ error: 'conversation_id, message_text, and risk_level are required' }, { status: 400 });
  }

  if (!['green', 'yellow', 'red'].includes(riskLevel)) {
    return NextResponse.json({ error: 'risk_level must be green, yellow, or red' }, { status: 400 });
  }

  const row = await createApprovalRequest({ tenantId: tenant.id, conversationId, messageText, riskLevel: riskLevel as 'green' | 'yellow' | 'red' });
  return NextResponse.json({ ok: true, approvalRequest: row }, { status: 201 });
}
