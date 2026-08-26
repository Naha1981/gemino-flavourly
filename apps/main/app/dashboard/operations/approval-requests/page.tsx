import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { listApprovalRequests } from '@/lib/operations/approval-request-store';
import { ApprovalActions } from './approval-actions';

export const dynamic = 'force-dynamic';

export default async function ApprovalRequestsPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const [pending, approved, rejected] = await Promise.all([
    listApprovalRequests(tenant.id, 'pending'),
    listApprovalRequests(tenant.id, 'approved'),
    listApprovalRequests(tenant.id, 'rejected'),
  ]);
  const resolved = approved.concat(rejected);

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-4">
        <h1 className="text-xl font-semibold text-zinc-50">Approval Requests</h1>
        <p className="text-xs text-zinc-400">
          {pending.length} pending · {resolved.length} resolved. Review messages that require approval before dispatch.
        </p>
      </div>

      {pending.length === 0 && resolved.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-400">
          No approval requests yet. They appear here when a message is flagged for review.
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-amber-300">Pending</h2>
              {pending.map((req) => (
                <div key={req.id} className="rounded-lg border border-amber-900/50 bg-zinc-900/70 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                      req.riskLevel === 'red' ? 'bg-red-950 text-red-300' :
                      req.riskLevel === 'yellow' ? 'bg-amber-950 text-amber-300' :
                      'bg-emerald-950 text-emerald-300'
                    }`}>
                      {req.riskLevel.toUpperCase()}
                    </span>
                    <span>Risk level</span>
                    <span className="ml-auto">{new Date(req.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-200">
                    {req.messageText}
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">Conversation: {req.conversationId}</p>
                  <ApprovalActions requestId={req.id} />
                </div>
              ))}
            </div>
          )}

          {resolved.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-zinc-400">Resolved</h2>
              {resolved.map((req) => (
                <div key={req.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 opacity-75">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                      req.status === 'approved' ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'
                    }`}>
                      {req.status}
                    </span>
                    <span>{req.riskLevel.toUpperCase()}</span>
                    <span className="ml-auto">{new Date(req.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-400 line-through decoration-zinc-600">
                    {req.messageText}
                  </p>
                  {req.approvedBy && (
                    <p className="mt-2 text-xs text-zinc-500">By {req.approvedBy} on {new Date(req.approvedAt!).toLocaleString()}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
