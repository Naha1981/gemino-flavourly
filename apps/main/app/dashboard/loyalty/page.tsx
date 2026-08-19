import { db } from '@/lib/db';
import { contacts, loyaltyRewards, loyaltyTransactions } from '@/lib/db/schema';
import { desc, gt } from 'drizzle-orm';
import Link from 'next/link';
import { ArrowLeft, Sparkles, Gift, Award, TrendingUp } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function LoyaltyPage() {
  const topLoyaltyGuests = await db
    .select()
    .from(contacts)
    .orderBy(desc(contacts.loyaltyPoints))
    .limit(10)
    .catch(() => []);

  const rewards = await db
    .select()
    .from(loyaltyRewards)
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
              <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">WhatsApp Loyalty Program & Rewards</h1>
              <p className="text-xs text-zinc-400">Automate customer points balance lookups and reward redemptions.</p>
            </div>
          </div>
        </div>

        {/* 2 Column Layout: Rewards & Top Members */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Rewards List */}
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Gift className="w-4 h-4 text-emerald-400" />
                Active Redeemable Rewards
              </h2>
            </div>

            <div className="space-y-3">
              <div className="p-4 rounded-md bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-zinc-100">Complimentary Chef Dessert or Specialty Coffee</h4>
                  <p className="text-[11px] text-zinc-400 mt-0.5">Automated on WhatsApp balance &gt; 100</p>
                </div>
                <span className="px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-xs font-mono font-bold">
                  100 Pts
                </span>
              </div>

              <div className="p-4 rounded-md bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-zinc-100">R100 Dine-In Bill Voucher</h4>
                  <p className="text-[11px] text-zinc-400 mt-0.5">Automated discount voucher code</p>
                </div>
                <span className="px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-xs font-mono font-bold">
                  250 Pts
                </span>
              </div>

              <div className="p-4 rounded-md bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-zinc-100">VIP Chef Table Reservation with Sparkling Wine</h4>
                  <p className="text-[11px] text-zinc-400 mt-0.5">Exclusive VIP tier reward</p>
                </div>
                <span className="px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-xs font-mono font-bold">
                  500 Pts
                </span>
              </div>
            </div>
          </div>

          {/* Top VIP Members */}
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                Top VIP Loyalty Members
              </h2>
            </div>

            <div className="divide-y divide-zinc-800/60">
              {topLoyaltyGuests.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500">
                  No loyalty members recorded yet. When guests text *JOIN* or *POINTS*, they appear here.
                </div>
              ) : (
                topLoyaltyGuests.map((guest) => (
                  <div key={guest.id} className="py-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-zinc-100">{guest.name || 'VIP Member'}</p>
                      <p className="text-[11px] text-zinc-500 font-mono">+{guest.phone}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-amber-400 font-mono">
                        {guest.loyaltyPoints} Points
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
