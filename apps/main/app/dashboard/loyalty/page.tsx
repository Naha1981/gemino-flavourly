import { redirect } from 'next/navigation';
import { db, initDb } from '@/lib/db';
import { contacts, loyaltyRewards, loyaltyTransactions } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { Gift, Award } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { awardLoyaltyAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function LoyaltyPage() {
  await initDb();
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const topLoyaltyGuests = await db
    .select()
    .from(contacts)
    .where(eq(contacts.tenantId, tenant.id))
    .orderBy(desc(contacts.loyaltyPoints))
    .limit(10)
    .catch(() => []);

  const rewards = await db
    .select()
    .from(loyaltyRewards)
    .where(eq(loyaltyRewards.tenantId, tenant.id))
    .catch(() => []);

  const ledger = await db
    .select()
    .from(loyaltyTransactions)
    .where(eq(loyaltyTransactions.tenantId, tenant.id))
    .orderBy(desc(loyaltyTransactions.createdAt))
    .limit(8)
    .catch(() => []);

  const catalog =
    rewards.length > 0
      ? rewards
      : [
          { id: 'd1', name: 'Complimentary dessert or coffee', pointsCost: 100 },
          { id: 'd2', name: 'R100 dine-in voucher', pointsCost: 250 },
          { id: 'd3', name: 'Chef’s table + sparkling', pointsCost: 500 },
        ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-saffron">Regulars</p>
        <h1 className="font-display text-4xl text-cream">Loyalty</h1>
        <p className="mt-1 text-sm text-cream-dim">Guests text POINTS. You award from the floor. The ledger is the source of truth.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-ink-2 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-cream">
            <Gift className="h-4 w-4 text-saffron" />
            Catalog
          </h2>
          <div className="space-y-3">
            {catalog.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl border border-line bg-ink px-4 py-3">
                <p className="text-sm text-cream">{r.name}</p>
                <span className="font-mono text-xs text-saffron">{r.pointsCost} pts</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-ink-2 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-cream">
            <Award className="h-4 w-4 text-saffron" />
            Top guests
          </h2>
          {topLoyaltyGuests.length === 0 ? (
            <p className="py-8 text-center text-sm text-cream-dim">No members yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {topLoyaltyGuests.map((guest) => (
                <li key={guest.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm text-cream">{guest.name || 'Guest'}</p>
                    <p className="font-mono text-[11px] text-cream-dim">+{guest.phone}</p>
                    <form action={awardLoyaltyAction} className="mt-2 flex gap-2">
                      <input type="hidden" name="contactId" value={guest.id} />
                      <input
                        name="amount"
                        defaultValue="20"
                        className="w-16 rounded border border-line bg-ink px-2 py-1 text-xs"
                      />
                      <input type="hidden" name="description" value="Floor visit award" />
                      <button className="rounded bg-saffron px-2 py-1 text-[11px] font-semibold text-ink">Award</button>
                    </form>
                  </div>
                  <span className="font-mono text-sm text-saffron">{guest.loyaltyPoints}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-ink-2 p-6">
        <h2 className="mb-3 text-sm font-medium text-cream">Ledger</h2>
        {ledger.length === 0 ? (
          <p className="text-sm text-cream-dim">No movements yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {ledger.map((row) => (
              <li key={row.id} className="flex justify-between text-cream-dim">
                <span>
                  {row.type} · {row.description}
                </span>
                <span className="font-mono text-cream">
                  {row.amount > 0 ? '+' : ''}
                  {row.amount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
