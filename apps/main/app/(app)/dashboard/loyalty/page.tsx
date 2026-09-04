import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { contacts, loyaltyRewards } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { ArrowLeft, Sparkles, Gift, Award, TrendingUp } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function LoyaltyPage() {
  // Same cross-tenant leak as the waitlist page: no auth() call, no
  // tenantId filter — every restaurant's top loyalty guests (names,
  // phone numbers, point balances) were visible to any signed-in user.
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
              <h1 className="text-xl font-semibold text-app-fg tracking-tight">WhatsApp Loyalty Program & Rewards</h1>
              <p className="text-xs text-app-muted">Automate customer points balance lookups and reward redemptions.</p>
            </div>
          </div>
        </div>

        {/* 2 Column Layout: Rewards & Top Members */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Rewards List */}
          <div className="bg-app-surface-0/70 border border-app-border rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-app-border pb-3">
              <h2 className="text-sm font-semibold text-app-fg flex items-center gap-2">
                <Gift className="w-4 h-4 text-emerald-400" />
                Active Redeemable Rewards
              </h2>
            </div>

            <div className="space-y-3">
              <div className="p-4 rounded-md bg-app-bg border border-app-border flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-app-fg">Complimentary Chef Dessert or Specialty Coffee</h4>
                  <p className="text-[11px] text-app-muted mt-0.5">Automated on WhatsApp balance &gt; 100</p>
                </div>
                <span className="px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-xs font-mono font-bold">
                  100 Pts
                </span>
              </div>

              <div className="p-4 rounded-md bg-app-bg border border-app-border flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-app-fg">R100 Dine-In Bill Voucher</h4>
                  <p className="text-[11px] text-app-muted mt-0.5">Automated discount voucher code</p>
                </div>
                <span className="px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-xs font-mono font-bold">
                  250 Pts
                </span>
              </div>

              <div className="p-4 rounded-md bg-app-bg border border-app-border flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-app-fg">VIP Chef Table Reservation with Sparkling Wine</h4>
                  <p className="text-[11px] text-app-muted mt-0.5">Exclusive VIP tier reward</p>
                </div>
                <span className="px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-xs font-mono font-bold">
                  500 Pts
                </span>
              </div>
            </div>
          </div>

          {/* Top VIP Members */}
          <div className="bg-app-surface-0/70 border border-app-border rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-app-border pb-3">
              <h2 className="text-sm font-semibold text-app-fg flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                Top VIP Loyalty Members
              </h2>
            </div>

            <div className="divide-y divide-app-border/60">
              {topLoyaltyGuests.length === 0 ? (
                <div className="py-12 text-center text-xs text-app-faint">
                  No loyalty members recorded yet. When guests text *JOIN* or *POINTS*, they appear here.
                </div>
              ) : (
                topLoyaltyGuests.map((guest) => (
                  <div key={guest.id} className="py-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-app-fg">{guest.name || 'VIP Member'}</p>
                      <p className="text-[11px] text-app-faint font-mono">+{guest.phone}</p>
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
