/**
 * O1 — GPS-gated reward redemption: Drizzle store.
 *
 * The rules live in ./reward-claim.ts (pure, unit-tested); this module is
 * the only place that touches the database, mirroring the repo's
 * logic/store split (see reactivation, birthday, cancellation stores).
 *
 * Money-safety properties (each pinned by a wiring test):
 *   - welcome bonus and visit earns are exactly-once (ref_id unique index)
 *   - points are deducted only when an event flips to `verified`
 *   - the pending→verified flip is atomic (`WHERE status='pending'`) so two
 *     concurrent geo-claim POSTs can never double-deduct
 *   - every write is tenant-scoped by construction (tenantId comes from the
 *     resolved tenant/session, never from client input)
 */

import { db } from '@/lib/db';
import {
  contacts,
  conversations,
  loyaltyRewards,
  loyaltyTransactions,
  reservations,
  rewardEvents,
  tenants,
} from '@/lib/db/schema';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import {
  DEFAULT_REWARD,
  REWARD_EVENT_TTL_MINUTES,
  VISIT_FLAT_BONUS_POINTS,
  WELCOME_BONUS_POINTS,
  decideRewardClaim,
  largestAffordableReward,
  newClaimToken,
  type Point,
  type RewardLike,
} from './reward-claim';
import { pointsForSpend } from './loyalty';

// ─────────────────────────────────────────────────────────────────────────────
// Rewards catalog
// ─────────────────────────────────────────────────────────────────────────────

/** Active catalog for a tenant; the canonical default when none is configured. */
export async function listRewardCatalog(tenantId: string): Promise<RewardLike[]> {
  const rows = await db
    .select({ name: loyaltyRewards.name, pointsCost: loyaltyRewards.pointsCost })
    .from(loyaltyRewards)
    .where(and(eq(loyaltyRewards.tenantId, tenantId), eq(loyaltyRewards.isActive, true)))
    .orderBy(desc(loyaltyRewards.pointsCost))
    .catch(() => [] as { name: string; pointsCost: number }[]);
  if (rows.length === 0) return [{ ...DEFAULT_REWARD }];
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOIN — one-time welcome bonus
// ─────────────────────────────────────────────────────────────────────────────

export interface JoinOutcome {
  awarded: boolean;
  points: number;
}

/**
 * Award the welcome bonus exactly once per contact. The deterministic ref_id
 * (`welcome:{contactId}`) plus the unique index makes a retried webhook or a
 * double-tap a no-op instead of a double award.
 */
export async function awardWelcomeBonusOnce(tenantId: string, contactId: string): Promise<JoinOutcome> {
  const inserted = await db
    .insert(loyaltyTransactions)
    .values({
      tenantId,
      contactId,
      type: 'bonus',
      amount: WELCOME_BONUS_POINTS,
      description: 'Welcome bonus (JOIN)',
      refId: `welcome:${contactId}`,
    })
    .onConflictDoNothing({ target: loyaltyTransactions.refId })
    .returning({ id: loyaltyTransactions.id });

  if (inserted.length === 0) {
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, contactId),
      columns: { loyaltyPoints: true },
    });
    return { awarded: false, points: contact?.loyaltyPoints ?? 0 };
  }

  const updated = await db
    .update(contacts)
    .set({ loyaltyPoints: sql`${contacts.loyaltyPoints} + ${WELCOME_BONUS_POINTS}` })
    .where(eq(contacts.id, contactId))
    .returning({ loyaltyPoints: contacts.loyaltyPoints });

  return { awarded: true, points: updated[0]?.loyaltyPoints ?? WELCOME_BONUS_POINTS };
}

// ─────────────────────────────────────────────────────────────────────────────
// Restaurant location (GPS gate anchor)
// ─────────────────────────────────────────────────────────────────────────────

/** The tenant's geocoded location, or null when GPS verification is impossible. */
export async function getTenantLocation(tenantId: string): Promise<Point | null> {
  const row = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { latitude: true, longitude: true },
  });
  if (!row?.latitude || !row?.longitude) return null;
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

// ─────────────────────────────────────────────────────────────────────────────
// REDEEM — pending reward event + geo-claim link
// ─────────────────────────────────────────────────────────────────────────────

export type CreatePendingResult =
  | {
      ok: true;
      token: string;
      reward: RewardLike;
      remainingPoints: number;
      expiresAt: Date;
    }
  | { ok: false; reason: 'insufficient_points'; points: number; needed: number }
  | { ok: false; reason: 'restaurant_location_missing' };

/**
 * Create a pending reward event for the contact's best affordable reward.
 * Any earlier pending event for the same contact is expired ('superseded')
 * so at most one live geo-claim link exists per guest.
 */
export async function createPendingRewardEvent(input: {
  tenantId: string;
  contactId: string;
  conversationId: string;
  pointsBalance: number;
  catalog: readonly RewardLike[];
}): Promise<CreatePendingResult> {
  const location = await getTenantLocation(input.tenantId);
  if (!location) return { ok: false, reason: 'restaurant_location_missing' };

  const reward = largestAffordableReward(input.pointsBalance, input.catalog);
  if (!reward) {
    const needed = input.catalog.reduce(
      (min, r) => (r.pointsCost > 0 && (min === 0 || r.pointsCost < min) ? r.pointsCost : min),
      0
    );
    return { ok: false, reason: 'insufficient_points', points: input.pointsBalance, needed };
  }

  // Supersede: one live claim per contact.
  await db
    .update(rewardEvents)
    .set({ status: 'expired', rejectionReason: 'superseded' })
    .where(
      and(
        eq(rewardEvents.tenantId, input.tenantId),
        eq(rewardEvents.contactId, input.contactId),
        eq(rewardEvents.status, 'pending')
      )
    )
    .catch(() => undefined);

  const token = newClaimToken();
  const expiresAt = new Date(Date.now() + REWARD_EVENT_TTL_MINUTES * 60 * 1000);

  await db.insert(rewardEvents).values({
    tenantId: input.tenantId,
    contactId: input.contactId,
    conversationId: input.conversationId,
    rewardName: reward.name,
    pointsCost: reward.pointsCost,
    status: 'pending',
    claimToken: token,
    expiresAt,
  });

  return {
    ok: true,
    token,
    reward,
    remainingPoints: input.pointsBalance - reward.pointsCost,
    expiresAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Geo-claim verification
// ─────────────────────────────────────────────────────────────────────────────

export interface RewardEventRow {
  id: string;
  tenantId: string;
  contactId: string;
  rewardName: string;
  pointsCost: number;
  status: 'pending' | 'verified' | 'rejected' | 'expired';
  claimToken: string;
  distanceM: number | null;
  rejectionReason: string | null;
  expiresAt: Date;
  createdAt: Date;
  verifiedAt: Date | null;
}

export type VerifyResult =
  | { outcome: 'not_found' }
  | { outcome: 'verified'; distanceM: number; rewardName: string; remainingPoints: number }
  | { outcome: 'already_verified'; rewardName: string }
  | { outcome: 'already_final'; status: 'rejected' | 'expired'; reason: string | null }
  | { outcome: 'expired' }
  | { outcome: 'rejected_too_far'; distanceM: number }
  | { outcome: 'insufficient_points'; points: number; needed: number }
  | { outcome: 'restaurant_location_missing' };

/** Look up a live/final event by its single-use token. */
export async function findRewardEventByToken(token: string): Promise<RewardEventRow | null> {
  const row = await db.query.rewardEvents.findFirst({ where: eq(rewardEvents.claimToken, token) });
  if (!row) return null;
  return row as RewardEventRow;
}

/**
 * Verify a geo-claim submission. Single-use: any submission (success OR too
 * far) finalises the event — the guest texts REDEEM again for a fresh link.
 * The pending→final transition is guarded by `WHERE status='pending'` so a
 * double-POST race cannot double-deduct.
 */
export async function verifyRewardEventWithLocation(input: {
  token: string;
  guest: Point;
}): Promise<VerifyResult> {
  const event = await findRewardEventByToken(input.token);
  if (!event) return { outcome: 'not_found' };

  if (event.status === 'verified') return { outcome: 'already_verified', rewardName: event.rewardName };
  if (event.status === 'rejected' || event.status === 'expired') {
    return { outcome: 'already_final', status: event.status, reason: event.rejectionReason };
  }

  // Lazy TTL check — the expiry cron sweeps, but a submission racing it must
  // still fail closed.
  if (event.expiresAt.getTime() <= Date.now()) {
    await db
      .update(rewardEvents)
      .set({ status: 'expired', rejectionReason: 'ttl' })
      .where(and(eq(rewardEvents.id, event.id), eq(rewardEvents.status, 'pending')))
      .catch(() => undefined);
    return { outcome: 'expired' };
  }

  const restaurant = await getTenantLocation(event.tenantId);
  if (!restaurant) return { outcome: 'restaurant_location_missing' };

  const decision = decideRewardClaim(input.guest, restaurant);

  if (!decision.ok) {
    await db
      .update(rewardEvents)
      .set({
        status: 'rejected',
        gpsLat: input.guest.lat,
        gpsLng: input.guest.lng,
        distanceM: decision.distanceM,
        rejectionReason: 'too_far',
        claimedAt: new Date(),
      })
      .where(and(eq(rewardEvents.id, event.id), eq(rewardEvents.status, 'pending')))
      .catch(() => undefined);
    return { outcome: 'rejected_too_far', distanceM: decision.distanceM };
  }

  // Balance re-check at verify time: points may have changed since the link
  // was issued. Fail closed rather than letting a balance go negative.
  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.id, event.contactId),
    columns: { loyaltyPoints: true },
  });
  const balance = contact?.loyaltyPoints ?? 0;
  if (balance < event.pointsCost) {
    await db
      .update(rewardEvents)
      .set({
        status: 'rejected',
        gpsLat: input.guest.lat,
        gpsLng: input.guest.lng,
        distanceM: decision.distanceM,
        rejectionReason: 'insufficient_points',
        claimedAt: new Date(),
      })
      .where(and(eq(rewardEvents.id, event.id), eq(rewardEvents.status, 'pending')))
      .catch(() => undefined);
    return { outcome: 'insufficient_points', points: balance, needed: event.pointsCost };
  }

  // Atomic finalisation: only one concurrent request can flip pending.
  const flipped = await db
    .update(rewardEvents)
    .set({
      status: 'verified',
      gpsLat: input.guest.lat,
      gpsLng: input.guest.lng,
      distanceM: decision.distanceM,
      claimedAt: new Date(),
      verifiedAt: new Date(),
    })
    .where(and(eq(rewardEvents.id, event.id), eq(rewardEvents.status, 'pending')))
    .returning({ id: rewardEvents.id });

  if (flipped.length === 0) {
    // Lost the race — report the winner's outcome.
    const fresh = await findRewardEventByToken(input.token);
    if (!fresh) return { outcome: 'not_found' };
    if (fresh.status === 'verified') return { outcome: 'already_verified', rewardName: fresh.rewardName };
    return {
      outcome: 'already_final',
      status: fresh.status === 'rejected' ? 'rejected' : 'expired',
      reason: fresh.rejectionReason,
    };
  }

  // Ledger write is idempotent on ref_id — a retry heals a crashed deduct.
  await db
    .insert(loyaltyTransactions)
    .values({
      tenantId: event.tenantId,
      contactId: event.contactId,
      type: 'redeem',
      amount: -event.pointsCost,
      description: `Redeemed: ${event.rewardName} (GPS verified at ${decision.distanceM}m)`,
      refId: `redeem:${event.id}`,
    })
    .onConflictDoNothing({ target: loyaltyTransactions.refId });

  const updated = await db
    .update(contacts)
    .set({ loyaltyPoints: sql`GREATEST(${contacts.loyaltyPoints} - ${event.pointsCost}, 0)` })
    .where(eq(contacts.id, event.contactId))
    .returning({ loyaltyPoints: contacts.loyaltyPoints });

  return {
    outcome: 'verified',
    distanceM: decision.distanceM,
    rewardName: event.rewardName,
    remainingPoints: updated[0]?.loyaltyPoints ?? balance - event.pointsCost,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Complete & Earn (staff endpoint)
// ─────────────────────────────────────────────────────────────────────────────

export type CompleteVisitResult =
  | { ok: true; points: number; contactPoints: number; alreadyEarned: boolean }
  | { ok: false; reason: 'not_found' | 'invalid_status' | 'invalid_amount' | 'no_contact' };

/**
 * Mark a visit complete and award its points — exactly once per reservation
 * (ref_id `visit:{reservationId}`). Spend, when provided by staff, converts
 * via the canonical rule (1 point per R1); no spend recorded earns the flat
 * visit bonus.
 */
export async function completeVisitAndEarn(input: {
  tenantId: string;
  reservationId: string;
  spendCents?: number | null;
}): Promise<CompleteVisitResult> {
  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, input.reservationId), eq(reservations.tenantId, input.tenantId)),
    columns: { id: true, contactId: true, status: true },
  });
  if (!reservation) return { ok: false, reason: 'not_found' };
  if (reservation.status === 'cancelled' || reservation.status === 'no_show') {
    return { ok: false, reason: 'invalid_status' };
  }
  // Loyalty cannot be awarded without a linked contact (a walk-in booking
  // taken over the phone may have none). Fail honestly instead of awarding
  // points into the void.
  if (!reservation.contactId) return { ok: false, reason: 'no_contact' };

  const spendCents = input.spendCents ?? null;
  if (spendCents !== null && (!Number.isFinite(spendCents) || spendCents < 0)) {
    return { ok: false, reason: 'invalid_amount' };
  }
  const points = spendCents !== null ? pointsForSpend(spendCents) : VISIT_FLAT_BONUS_POINTS;
  if (points <= 0) return { ok: false, reason: 'invalid_amount' };

  const inserted = await db
    .insert(loyaltyTransactions)
    .values({
      tenantId: input.tenantId,
      contactId: reservation.contactId,
      type: 'earn',
      amount: points,
      description:
        spendCents !== null
          ? `Visit completed (spend R${(spendCents / 100).toFixed(2)})`
          : 'Visit completed (flat bonus)',
      refId: `visit:${reservation.id}`,
    })
    .onConflictDoNothing({ target: loyaltyTransactions.refId })
    .returning({ id: loyaltyTransactions.id });

  if (reservation.status === 'confirmed') {
    await db
      .update(reservations)
      .set({ status: 'completed' })
      .where(and(eq(reservations.id, reservation.id), eq(reservations.status, 'confirmed')))
      .catch(() => undefined);
  }

  if (inserted.length === 0) {
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, reservation.contactId),
      columns: { loyaltyPoints: true },
    });
    return { ok: true, points: 0, contactPoints: contact?.loyaltyPoints ?? 0, alreadyEarned: true };
  }

  const updated = await db
    .update(contacts)
    .set({ loyaltyPoints: sql`${contacts.loyaltyPoints} + ${points}` })
    .where(eq(contacts.id, reservation.contactId))
    .returning({ loyaltyPoints: contacts.loyaltyPoints });

  return { ok: true, points, contactPoints: updated[0]?.loyaltyPoints ?? points, alreadyEarned: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Expiry sweep (cron) + dashboard listing
// ─────────────────────────────────────────────────────────────────────────────

/** Expire pending events whose TTL elapsed. Idempotent; returns the count. */
export async function expireStaleRewardEvents(now: Date = new Date()): Promise<number> {
  const expired = await db
    .update(rewardEvents)
    .set({ status: 'expired', rejectionReason: 'ttl' })
    .where(and(eq(rewardEvents.status, 'pending'), lt(rewardEvents.expiresAt, now)))
    .returning({ id: rewardEvents.id })
    .catch(() => [] as { id: string }[]);
  return expired.length;
}

export interface PendingRewardEventView {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  rewardName: string;
  pointsCost: number;
  status: string;
  expiresAt: Date;
  distanceM: number | null;
}

interface RewardEventJoinRow extends PendingRewardEventView {
  createdAt: Date;
}

/** Pending + recently-finalised events for the loyalty dashboard. */
export async function listRecentRewardEvents(
  tenantId: string,
  limit = 20
): Promise<PendingRewardEventView[]> {
  const rows: RewardEventJoinRow[] = await db
    .select({
      id: rewardEvents.id,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      rewardName: rewardEvents.rewardName,
      pointsCost: rewardEvents.pointsCost,
      status: rewardEvents.status,
      expiresAt: rewardEvents.expiresAt,
      distanceM: rewardEvents.distanceM,
      createdAt: rewardEvents.createdAt,
    })
    .from(rewardEvents)
    .leftJoin(contacts, eq(contacts.id, rewardEvents.contactId))
    .where(eq(rewardEvents.tenantId, tenantId))
    .orderBy(desc(rewardEvents.createdAt))
    .limit(limit)
    .catch(() => [] as RewardEventJoinRow[]);
  return rows;
}

/** Guard for the responder: conversation must belong to the tenant. */
export async function conversationBelongsToTenant(
  conversationId: string,
  tenantId: string
): Promise<boolean> {
  const row = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)),
    columns: { id: true },
  });
  return Boolean(row);
}
