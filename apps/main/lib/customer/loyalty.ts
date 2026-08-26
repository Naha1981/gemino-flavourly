/**
 * Loyalty program rules (Rewards/Loyalty system).
 *
 * PRD: R1 spent = 1 point; 100 points = R10 off. This module holds the
 * canonical rules + the customer-facing balance/redeem copy so the responder
 * (WhatsApp) and the loyalty page surface the same amounts. Pure and
 * framework-free for unit testing.
 */

/** R1 spent -> 1 point. */
export function pointsForSpend(spendCents: number): number {
  const rand = Math.max(0, Math.floor(spendCents / 100));
  return rand;
}

/** 100 points -> R10 off (1 point = R0.10). */
export const POINTS_PER_RAND = 1;
export const REWARD_POINTS_PER_R10 = 100;
export const REWARD_RAND_PER_100_POINTS = 10;

/** Round down to the whole number of R10 rewards a point balance covers. */
export function rewardsRedeemable(points: number): number {
  return Math.floor(Math.max(0, points) / REWARD_POINTS_PER_R10);
}

export function valueOffInRand(points: number): number {
  return rewardsRedeemable(points) * REWARD_RAND_PER_100_POINTS;
}

/** The balance message the AI responder sends back to a customer. */
export function loyaltyBalanceMessage(restaurantName: string, points: number): string {
  const redeemable = rewardsRedeemable(points);
  const randOff = valueOffInRand(points);
  const ready =
    redeemable > 0
      ? ` You have *R${randOff} off* ready to use.`
      : ` Keep earning — ${REWARD_POINTS_PER_R10} points = R${REWARD_RAND_PER_100_POINTS} off.`;
  return (
    `🌟 Hello! You currently have *${points} loyalty points* with ${restaurantName}. ` +
    `Earn 1 point for every R1 you spend. Redeem *${REWARD_POINTS_PER_R10} points = R${REWARD_RAND_PER_100_POINTS} off* your bill.` +
    `${ready} Ask our staff to redeem on your next visit!`
  );
}
