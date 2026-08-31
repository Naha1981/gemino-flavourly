import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { contacts, tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { findRewardEventByToken } from '@/lib/customer/reward-claim-store';
import { REWARD_EVENT_TTL_MINUTES } from '@/lib/customer/reward-claim';
import { GeoClaimClient } from './geo-claim-client';

export const dynamic = 'force-dynamic';

interface Props {
  params: { token: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await findRewardEventByToken(params.token).catch(() => null);
  if (!event) return { title: 'Claim your reward | Flavourly' };
  return { title: `${event.rewardName} | Flavourly` };
}

/**
 * O1 — guest-facing geo-claim page: /geo-claim/[token].
 *
 * NO AUTH REQUIRED (public prefix in route-guard-core): this is the page a
 * guest opens from the WhatsApp REDEEM reply. The single-use token in the
 * path is the credential. Server-renders the event's state so the page is
 * honest even before any geolocation prompt, and hands the pending case to
 * the client component, which asks the browser for coordinates and POSTs
 * them to /api/loyalty/geo-claim/[token].
 *
 * Single-use semantics: a pending event shows the verify button; a verified
 * event shows the success state staff can glance at; a rejected/expired
 * event explains what happened and tells the guest to text REDEEM again for
 * a fresh link.
 */
export default async function GeoClaimPage({ params }: Props) {
  const token = params.token;
  if (!token || !/^[a-f0-9]{16,128}$/i.test(token)) notFound();

  const event = await findRewardEventByToken(token).catch(() => null);
  if (!event) {
    return (
      <Shell>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 text-center">
          <p className="text-3xl">🔗</p>
          <h1 className="mt-3 text-lg font-semibold text-zinc-100">Link not found</h1>
          <p className="mt-2 text-sm text-zinc-400">
            This redemption link is not valid. Text <strong className="text-zinc-200">REDEEM</strong> to
            the restaurant on WhatsApp to get a fresh link.
          </p>
        </div>
      </Shell>
    );
  }

  const [[tenant], [contact]] = await Promise.all([
    db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, event.tenantId)).limit(1),
    db
      .select({ name: contacts.name, phone: contacts.phone })
      .from(contacts)
      .where(eq(contacts.id, event.contactId))
      .limit(1),
  ]);
  const restaurantName = tenant?.name ?? 'the restaurant';
  const guestName = contact?.name || 'there';

  if (event.status === 'verified') {
    return (
      <Shell>
        <div
          className="rounded-2xl border border-emerald-800/60 bg-emerald-950/40 p-8 text-center"
          data-testid="geo-claim-verified"
        >
          <p className="text-3xl">🎉</p>
          <h1 className="mt-3 text-lg font-semibold text-emerald-300">Reward unlocked!</h1>
          <p className="mt-2 text-sm text-zinc-300">
            {event.rewardName} for {guestName} — verified{' '}
            {event.distanceM !== null ? `at ${event.distanceM}m from ${restaurantName}` : ''}
            {event.verifiedAt ? ` on ${new Date(event.verifiedAt).toLocaleString('en-ZA')}` : ''}.
          </p>
          <p className="mt-4 text-xs text-zinc-500">
            Show this screen to your server to collect your reward.
          </p>
        </div>
      </Shell>
    );
  }

  if (event.status === 'rejected') {
    const reason =
      event.rejectionReason === 'insufficient_points'
        ? 'Your points balance changed since this link was issued.'
        : `Your location was ${event.distanceM ?? '?'}m away — rewards verify within 500m of the restaurant.`;
    return (
      <Shell>
        <div
          className="rounded-2xl border border-red-900/60 bg-red-950/30 p-8 text-center"
          data-testid="geo-claim-rejected"
        >
          <p className="text-3xl">📍</p>
          <h1 className="mt-3 text-lg font-semibold text-red-300">Location too far</h1>
          <p className="mt-2 text-sm text-zinc-300">{reason}</p>
          <p className="mt-4 text-xs text-zinc-500">
            Text <strong className="text-zinc-300">REDEEM</strong> again on WhatsApp once you&apos;re at
            the restaurant for a fresh link.
          </p>
        </div>
      </Shell>
    );
  }

  if (event.status === 'expired') {
    return (
      <Shell>
        <div
          className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 text-center"
          data-testid="geo-claim-expired"
        >
          <p className="text-3xl">⏳</p>
          <h1 className="mt-3 text-lg font-semibold text-zinc-100">Link expired</h1>
          <p className="mt-2 text-sm text-zinc-400">
            This redemption link was only valid for {REWARD_EVENT_TTL_MINUTES} minutes. Text{' '}
            <strong className="text-zinc-200">REDEEM</strong> on WhatsApp for a fresh one.
          </p>
        </div>
      </Shell>
    );
  }

  // Pending — hand off to the client verifier.
  return (
    <Shell>
      <GeoClaimClient
        token={token}
        restaurantName={restaurantName}
        guestName={guestName}
        rewardName={event.rewardName}
        pointsCost={event.pointsCost}
        ttlMinutes={REWARD_EVENT_TTL_MINUTES}
        expiresAtIso={event.expiresAt.toISOString()}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-zinc-800">
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center p-4">
        <div className="w-full space-y-4">{children}</div>
      </div>
    </div>
  );
}
