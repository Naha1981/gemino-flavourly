import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays, CheckCircle2, Clock3, UserRound } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { reservations } from '@/lib/db/schema';
import { eq,desc } from 'drizzle-orm';

export const dynamic='force-dynamic';

export default async function ReservationsPage(){
 const tenant=await getOrCreateTenant(); if(!tenant)redirect('/sign-in');
 const rows=await db.select({
   id:reservations.id,customerName:reservations.customerName,customerPhone:reservations.customerPhone,
   date:reservations.date,partySize:reservations.partySize,status:reservations.status,
   notes:reservations.notes,customerConfirmedAt:reservations.customerConfirmedAt,
 }).from(reservations).where(eq(reservations.tenantId,tenant.id)).orderBy(desc(reservations.date)).limit(200);
 const today=rows.filter(r=>new Date(r.date).toDateString()===new Date().toDateString());
 return <div className="space-y-6">
  <div><h1 className="headline-md flex items-center gap-2"><CalendarDays className="h-5 w-5 text-app-secondary"/> Reservations</h1><p className="label-sm mt-1 text-app-muted">One floor view for today's tables, confirmations, no-shows and completed visits.</p></div>
  <div className="grid gap-4 md:grid-cols-3">
   <div className="glass-card p-5"><p className="label-sm">Today</p><p className="headline-lg mt-1">{today.length}</p></div>
   <div className="glass-card p-5"><p className="label-sm">Confirmed</p><p className="headline-lg mt-1">{rows.filter(r=>r.status==='confirmed').length}</p></div>
   <div className="glass-card p-5"><p className="label-sm">No-shows</p><p className="headline-lg mt-1">{rows.filter(r=>r.status==='no_show').length}</p></div>
  </div>
  <div className="overflow-hidden rounded-2xl border border-app-border">
   <table className="w-full text-left text-sm"><thead className="bg-app-surface-1 text-xs uppercase"><tr><th className="px-4 py-3">Guest</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Party</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Confirmed</th><th className="px-4 py-3">Notes</th></tr></thead>
   <tbody className="divide-y divide-app-border">{rows.map(r=><tr key={r.id}>
    <td className="px-4 py-3"><div className="font-medium">{r.customerName||'Guest'}</div><div className="text-xs text-app-muted">{r.customerPhone||'—'}</div></td>
    <td className="px-4 py-3">{new Date(r.date).toLocaleString('en-ZA')}</td>
    <td className="px-4 py-3">{r.partySize}</td>
    <td className="px-4 py-3"><span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"><Clock3 className="h-3 w-3"/>{r.status}</span></td>
    <td className="px-4 py-3">{r.customerConfirmedAt?<span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3 w-3"/>Yes</span>:'—'}</td>
    <td className="px-4 py-3 text-xs text-app-muted">{r.notes||'—'}</td>
   </tr>)}</tbody></table>
   {rows.length===0&&<div className="p-8 text-center text-sm text-app-muted">No reservations yet. Customers will appear here as WhatsApp bookings are created.</div>}
  </div>
  <p className="text-xs text-app-muted">Staff quick actions are available from the API-backed reservation view; the next debug pass can add inline buttons without changing the underlying control model.</p>
  <Link href="/dashboard/intelligence" className="text-sm text-app-secondary">Back to Orderly Intelligence →</Link>
 </div>;
}
