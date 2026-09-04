import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { waitlistEntries } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import Link from 'next/link';
import { ArrowLeft, Users, Clock, CheckCircle, XCircle, Bell } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { notifyWaitlistEntryAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function WaitlistPage() {
  // This page previously queried waitlistEntries with no auth() call and
  // no tenantId filter at all — any signed-in user, from any restaurant,
  // could see every other restaurant's waitlist: guest names, phone
  // numbers, and party sizes. Now scoped to the signed-in owner's own
  // tenant, matching the pattern already used correctly on /dashboard
  // and /dashboard/inbox.
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const entries = await db
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.tenantId, tenant.id))
    .orderBy(desc(waitlistEntries.createdAt))
    .limit(30)
    .catch(() => []);

  return (
    <div className="min-h-screen bg-app-bg text-app-fg p-6 md:p-10 selection:bg-app-surface-1">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-app-border">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-2 rounded-md bg-app-surface-0 border border-app-border hover:bg-app-surface-1 text-app-muted hover:text-app-fg transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-app-fg tracking-tight">Daily Waitlist & Queue Dispatcher</h1>
              <p className="text-xs text-app-muted">Manage live guest queue and broadcast table readiness via WhatsApp.</p>
            </div>
          </div>
        </div>

        {/* Waitlist Table */}
        <div className="bg-app-surface-0/70 border border-app-border rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-app-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-app-fg">Live Waiting Parties</h2>
            <span className="text-xs text-app-muted font-mono">{entries.length} active entries</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-app-bg text-app-muted font-medium border-b border-app-border">
                <tr>
                  <th className="px-6 py-3.5">Guest Name</th>
                  <th className="px-6 py-3.5">WhatsApp Phone</th>
                  <th className="px-6 py-3.5">Party Size</th>
                  <th className="px-6 py-3.5">Est. Wait Time</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border/70">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-app-faint">
                      No guests in waitlist queue. When guests text *WAITLIST* on WhatsApp, they appear here instantly.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-app-surface-1/40 transition-colors">
                      <td className="px-6 py-4 font-semibold text-app-fg">{entry.customerName || 'Guest'}</td>
                      <td className="px-6 py-4 text-app-muted font-mono">+{entry.customerPhone}</td>
                      <td className="px-6 py-4 text-app-fg">{entry.partySize} Guests</td>
                      <td className="px-6 py-4 text-app-muted">{entry.estimatedWaitMinutes} mins</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase ${
                            entry.status === 'waiting'
                              ? 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
                              : entry.status === 'offered'
                              ? 'bg-blue-950/60 text-blue-400 border border-blue-800/60'
                              : entry.status === 'seated'
                              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                              : 'bg-app-surface-1 text-app-muted'
                          }`}
                        >
                          {entry.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        {entry.status === 'waiting' ? (
                          <form action={notifyWaitlistEntryAction}>
                            <input type="hidden" name="entryId" value={entry.id} />
                            <button
                              type="submit"
                              className="px-3 py-1 bg-emerald-950 border border-emerald-800 text-emerald-400 rounded hover:bg-emerald-900/60 transition-colors text-[11px] font-medium"
                            >
                              Table Ready (Notify WA)
                            </button>
                          </form>
                        ) : entry.status === 'offered' ? (
                          <span className="text-[11px] text-app-faint">
                            Notified {entry.notifiedAt ? new Date(entry.notifiedAt).toLocaleTimeString() : ''}
                          </span>
                        ) : (
                          <span className="text-[11px] text-app-faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
