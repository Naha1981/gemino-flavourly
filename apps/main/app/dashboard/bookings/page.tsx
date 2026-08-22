import { redirect } from 'next/navigation';
import { db, initDb } from '@/lib/db';
import { reservations } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { getOrCreateTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function BookingsPage() {
  await initDb();
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const rows = await db
    .select()
    .from(reservations)
    .where(eq(reservations.tenantId, tenant.id))
    .orderBy(desc(reservations.date))
    .limit(50)
    .catch(() => []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-saffron">Covers</p>
        <h1 className="font-display text-4xl text-cream">Bookings</h1>
        <p className="mt-1 text-sm text-cream-dim">
          Reservations captured from WhatsApp. Guests say “book a table for 2 tomorrow 7pm”.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-ink-2">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-[11px] uppercase tracking-wider text-cream-dim">
            <tr>
              <th className="px-5 py-3">Guest</th>
              <th className="px-5 py-3">When</th>
              <th className="px-5 py-3">Party</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-12 text-center text-cream-dim">
                  No reservations yet. A complete booking message writes a row here and confirms on WhatsApp.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="text-cream">
                  <td className="px-5 py-4">
                    <div className="font-medium">{r.customerName || 'Guest'}</div>
                    <div className="font-mono text-[11px] text-cream-dim">+{r.customerPhone}</div>
                  </td>
                  <td className="px-5 py-4 text-cream-dim">
                    {r.date ? new Date(r.date).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td className="px-5 py-4">{r.partySize}</td>
                  <td className="px-5 py-4">
                    <span className="rounded-full border border-leaf/40 bg-leaf/10 px-2 py-0.5 text-[11px] uppercase text-emerald-300">
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
