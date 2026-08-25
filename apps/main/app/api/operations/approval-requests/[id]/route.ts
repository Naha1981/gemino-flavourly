import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getApprovalRequest, updateApprovalStatus } from '@/lib/operations/approval-request-store';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const requestId = url.searchParams.get('id')?.trim() ?? '';
  if (!requestId) {
    return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
  }

  let body: { status?: unknown; approved_by?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const status = typeof body.status === 'string' ? body.status.trim() : '';
  const approvedBy = typeof body.approved_by === 'string' ? body.approved_by.trim() : '';

  if (!['approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'status must be approved or rejected' }, { status: 400 });
  }
  if (!approvedBy) {
    return NextResponse.json({ error: 'approved_by is required' }, { status: 400 });
  }

  const existing = await getApprovalRequest(tenant.id, requestId);
  if (!existing) {
    return NextResponse.json({ error: 'Approval request not found' }, { status: 404 });
  }
  if (existing.status !== 'pending') {
    return NextResponse.json({ error: `Request is already ${existing.status}` }, { status: 409 });
  }

  const row = await updateApprovalStatus(tenant.id, requestId, status as 'approved' | 'rejected', approvedBy);
  if (!row) {
    return NextResponse.json({ error: 'Failed to update approval request' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, approvalRequest: row });
}
