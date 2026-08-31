/**
 * O1 — GPS-gated reward redemption: pure rules.
 *
 * PRD (Gate O1): a guest texts REDEEM, gets a single-use geo-claim link,
 * opens it at the table, the browser posts its coordinates, and the server
 * compares the distance to the restaurant (Haversine, great-circle) against
 * a 500m radius. Inside → verified + points deducted. Outside → rejected
 * with the distance shown. Every outcome stores distance_m so the dashboard
 * can audit "verified at 120m".
 *
 * Pure and framework-free (like lib/customer/loyalty.ts) so every rule is
 * unit-tested without a database; the Drizzle adapter lives in
 * ./reward-claim-store.ts.
 */

import { randomBytes } from 'node:crypto';

/** Great-circle distance in metres between two WGS84 points. */
export const EARTH_RADIUS_M = 6_371_000;

/** Redemption only completes within this radius of the restaurant. */
export const MAX_REWARD_DISTANCE_M = 500;

/**
 * How long a geo-claim link stays live. Short on purpose: the link is meant
 * to be opened at the table, and a 30-minute TTL means a link screenshotted
 * and reused next week is already dead (points are only deducted on
 * verified, so an expired event costs nothing).
 */
export const REWARD_EVENT_TTL_MINUTES = 30;

/** Welcome bonus for a first JOIN. One-time per contact (idempotent ref). */
export const WELCOME_BONUS_POINTS = 50;

/** Flat earn when a completed visit has no recorded spend. */
export const VISIT_FLAT_BONUS_POINTS = 5;

/**
 * Canonical fallback reward when the tenant has no loyalty_rewards rows:
 * the loyalty.ts rule "100 points = R10 off".
 */
export const DEFAULT_REWARD = {
  name: 'R10 off your bill',
  pointsCost: 100,
} as const;

export interface RewardLike {
  name: string;
  pointsCost: number;
}

export interface Point {
  lat: number;
  lng: number;
}

/** Haversine distance in metres. Symmetric, non-negative. */
export function haversineDistanceM(a: Point, b: Point): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type ClaimDecision =
  | { ok: true; distanceM: number }
  | { ok: false; reason: 'too_far'; distanceM: number };

/**
 * The single redemption decision. Boundary: exactly MAX_REWARD_DISTANCE_M
 * is inside ("within 500m"). The distance is always carried in the result so
 * the caller can show the guest *why* (PRD: "else rejected with distance
 * shown").
 */
export function decideRewardClaim(guest: Point, restaurant: Point): ClaimDecision {
  const distanceM = Math.round(haversineDistanceM(guest, restaurant));
  if (distanceM <= MAX_REWARD_DISTANCE_M) return { ok: true, distanceM };
  return { ok: false, reason: 'too_far', distanceM };
}

/** URL-length single-use token (same entropy class as the claim tokens). */
export function newClaimToken(): string {
  return randomBytes(24).toString('hex');
}

export function buildGeoClaimUrl(appUrl: string, token: string): string {
  const base = (appUrl || 'https://gemino.app').replace(/\/$/, '');
  return `${base}/geo-claim/${token}`;
}

/** The best (highest-cost) reward a balance can afford, or null. */
export function largestAffordableReward(
  points: number,
  catalog: readonly RewardLike[]
): RewardLike | null {
  const affordable = catalog.filter((r) => r.pointsCost > 0 && r.pointsCost <= points);
  if (affordable.length === 0) return null;
  return affordable.reduce((best, r) => (r.pointsCost > best.pointsCost ? r : best));
}

export function buildJoinReply(input: { restaurantName: string; awarded: boolean; points: number }): string {
  if (!input.awarded) {
    return (
      `🌟 You are already a ${input.restaurantName} loyalty member with *${input.points} points*.\n\n` +
      `Keep earning 1 point for every R1 you spend — reply *POINTS* any time to check your balance.`
    );
  }
  return (
    `🎉 Welcome to the ${input.restaurantName} loyalty family!\n\n` +
    `We've added a *${WELCOME_BONUS_POINTS}-point welcome bonus* — you now have *${input.points} points*.\n\n` +
    `Earn 1 point for every R1 you spend. Reply *POINTS* for your balance or *REDEEM* when you're ready to claim a reward.`
  );
}

export function buildRedeemReply(input: {
  restaurantName: string;
  rewardName: string;
  pointsCost: number;
  remainingPoints: number;
  claimUrl: string;
  ttlMinutes: number;
}): string {
  return (
    `🎁 Redeem confirmed for *${input.rewardName}* (${input.pointsCost} points)!\n\n` +
    `Open this link when you're at the restaurant to verify and claim your reward:\n${input.claimUrl}\n\n` +
    `The link is valid for ${input.ttlMinutes} minutes and works only within 500m of ${input.restaurantName}. ` +
    `Remaining balance after redemption: *${input.remainingPoints} points*.`
  );
}

export function buildRedeemInsufficientReply(input: {
  restaurantName: string;
  points: number;
  needed: number;
}): string {
  return (
    `You have *${input.points} points* — you need *${input.needed}* to redeem a reward.\n\n` +
    `Every R1 you spend at ${input.restaurantName} earns 1 point. Reply *POINTS* anytime to check your balance.`
  );
}

export function buildRedeemNoLocationReply(restaurantName: string): string {
  return (
    `Our redemption system needs a location check, but ${restaurantName} hasn't set its restaurant location yet.\n\n` +
    `Please mention this to our staff — they'll redeem your reward at the counter right away.`
  );
}
