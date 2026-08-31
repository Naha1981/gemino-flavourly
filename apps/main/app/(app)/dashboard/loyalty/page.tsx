import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { contacts, loyaltyRewards } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { ArrowLeft, Sparkles, Gift, Award, TrendingUp, MapPin } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { listRecentRewardEvents } from '@/lib/customer/reward-claim-store';

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

  // O1 — pending + recently-finalised geo-claims. The pending list is the
  // floor view: a waiter can glance at which rewards are waiting for the
  // guest to verify at the table, and the verified rows carry their
  // distance proof ("verified at 120m").
  const rewardEventViews = await listRecentRewardEvents(tenant.id, 12).catch(() => []);
  const pendingEvents = rewardEventViews.filter((e) => e.status === 'pending');
  const locationConfigured =
    tenant.latitude !== null && tenant.longitude !== null && tenant.latitude !== undefined;

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

        {/* O1 — GPS redemption status */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-sky-400" />
              GPS Reward Verifications
            </h2>
            {!locationConfigured && (
              <span className="px-2.5 py-1 rounded bg-amber-950/80 border border-amber-800 text-amber-400 text-[10px] font-semibold uppercase tracking-wide">
                Set restaurant location
              </span>
            )}
          </div>
          {!locationConfigured && (
            <p className="text-[11px] text-zinc-400">
              Add your restaurant address (Settings) so REDEEM links can verify guests within 500m.
              Until then, redemptions fall back to the counter.
            </p>
          )}
          <div className="divide-y divide-zinc-800/60">
            {rewardEventViews.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                No redemption requests yet. When a guest texts <span className="text-zinc-300 font-semibold">REDEEM</span>, their
                geo-verified claim appears here.
              </div>
            ) : (
              rewardEventViews.map((event) => (
                <div key={event.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-100 truncate">
                      {event.contactName || event.contactPhone || 'Guest'}
                      <span className="text-zinc-500 font-normal"> · {event.rewardName}</span>
                    </p>
                    <p className="text-[11px] text-zinc-500 font-mono truncate">
                      {event.contactPhone ? `+${event.contactPhone.replace(/^\+/, '')}` : '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {event.status === 'pending' && (
                      <span className="px-2.5 py-1 rounded bg-sky-950/80 border border-sky-800 text-sky-400 text-[10px] font-semibold uppercase tracking-wide">
                        At table
                      </span>
                    )}
                    {event.status === 'verified' && (
                      <span className="px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-[10px] font-semibold uppercase tracking-wide">
                        Verified{event.distanceM !== null ? ` · ${event.distanceM}m` : ''}
                      </span>
                    )}
                    {event.status === 'rejected' && (
                      <span className="px-2.5 py-1 rounded bg-red-950/80 border border-red-800 text-red-400 text-[10px] font-semibold uppercase tracking-wide">
                        Rejected{event.distanceM !== null ? ` · ${event.distanceM}m` : ''}
                      </span>
                    )}
                    {event.status === 'expired' && (
                      <span className="px-2.5 py-1 rounded bg-zinc-800/80 border border-zinc-700 text-zinc-400 text-[10px] font-semibold uppercase tracking-wide">
                        Expired
                      </span>
                    )}
                    <span className="text-[11px] text-zinc-600 font-mono">
                      {event.pointsCost} pts
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          {pendingEvents.length > 0 && (
            <p className="text-[10px] text-zinc-600">
              {pendingEvents.length} live claim link{pendingEvents.length === 1 ? '' : 's'} — each is
              single-use and expires 30 minutes after issue.
            </p>
          )}
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
