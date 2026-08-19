import { db } from '@/lib/db';
import { waitlistEntries, contacts } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import Link from 'next/link';
import { ArrowLeft, Users, Clock, CheckCircle, XCircle, Bell } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function WaitlistPage() {
  const entries = await db
    .select()
    .from(waitlistEntries)
    .orderBy(desc(waitlistEntries.createdAt))
    .limit(30)
    .catch(() => []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 selection:bg-zinc-800">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-2 rounded-md bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">Daily Waitlist & Queue Dispatcher</h1>
              <p className="text-xs text-zinc-400">Manage live guest queue and broadcast table readiness via WhatsApp.</p>
            </div>
          </div>
        </div>

        {/* Waitlist Table */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">Live Waiting Parties</h2>
            <span className="text-xs text-zinc-400 font-mono">{entries.length} active entries</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-950 text-zinc-400 font-medium border-b border-zinc-800">
                <tr>
                  <th className="px-6 py-3.5">Guest Name</th>
                  <th className="px-6 py-3.5">WhatsApp Phone</th>
                  <th className="px-6 py-3.5">Party Size</th>
                  <th className="px-6 py-3.5">Est. Wait Time</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-zinc-500">
                      No guests in waitlist queue. When guests text *WAITLIST* on WhatsApp, they appear here instantly.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-zinc-800/40 transition-colors">
                      <td className="px-6 py-4 font-semibold text-zinc-100">{entry.customerName || 'Guest'}</td>
                      <td className="px-6 py-4 text-zinc-400 font-mono">+{entry.customerPhone}</td>
                      <td className="px-6 py-4 text-zinc-200">{entry.partySize} Guests</td>
                      <td className="px-6 py-4 text-zinc-400">{entry.estimatedWaitMinutes} mins</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase ${
                            entry.status === 'waiting'
                              ? 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
                              : entry.status === 'offered'
                              ? 'bg-blue-950/60 text-blue-400 border border-blue-800/60'
                              : entry.status === 'seated'
                              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {entry.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button className="px-3 py-1 bg-emerald-950 border border-emerald-800 text-emerald-400 rounded hover:bg-emerald-900/60 transition-colors text-[11px] font-medium">
                          Table Ready (Notify WA)
                        </button>
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
