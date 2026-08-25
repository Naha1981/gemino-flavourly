import { redirect } from 'next/navigation';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { reservations } from '@/lib/db/schema';
import { getOrCreateTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function ReviewRequestsPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');
  const requests = await db.select().from(reservations).where(and(eq(reservations.tenantId, tenant.id), eq(reservations.reviewRequestSent, true), gte(reservations.reviewRequestSentAt, new Date(Date.now() - 30 * 86400000)))).orderBy(desc(reservations.reviewRequestSentAt));
  return <div className="mx-auto max-w-5xl space-y-6"><div><p className="text-xs uppercase tracking-widest text-emerald-400">Reputation</p><h1 className="mt-2 text-2xl font-semibold">Review requests</h1><p className="mt-2 text-sm text-zinc-400">{requests.length} requests sent in the last 30 days.</p></div><div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/70">{requests.length === 0 ? <p className="p-8 text-center text-sm text-zinc-500">No review requests sent yet.</p> : requests.map((request) => <div key={request.id} className="flex justify-between p-5 text-sm"><span>{request.customerName || request.customerPhone || 'Customer'}</span><span className="text-zinc-500">{request.reviewRequestSentAt?.toLocaleString()}</span></div>)}</div></div>;
}