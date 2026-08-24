/**
 * Gate #13 — Post-visit review request logic, framework-free.
 *
 * Eligibility (the gate contract, made midnight-safe):
 *   - status is 'confirmed' (the gate's wording) OR 'completed' — flipping a
 *     booking to completed is staff saying "they dined", which is even
 *     stronger evidence the visit happened; skipping completed bookings
 *     would punish restaurants that keep their book tidy.
 *   - review_request_sent is false (asked exactly once per booking)
 *   - the booking's datetime is at least 2 hours in the past ("message
 *     customers 2 hours after dining")
 *   - …and not more than 26 hours in the past. The gate says "date = today"
 *     but a 22:00 booking whose 2-hour window crosses midnight is still
 *     yesterday's dinner; 26h covers that without sweeping stale bookings
 *     from days ago (a request three days after the meal feels like spam,
 *     and POPIA expects prompt, relevant processing).
 */

export interface ReviewRequestReservation {
  id: string;
  tenantId: string;
  customerName: string | null;
  customerPhone: string | null;
  /** Full booking datetime (the reservations.date column). */
  date: Date;
  status: string;
  reviewRequestSent: boolean;
  conversationId: string | null;
  /** POPIA: contact opted out with STOP — must never be messaged. */
  blocklisted: boolean;
}

/** Hours after the booking's time before we ask for a review. */
export const REVIEW_REQUEST_DELAY_HOURS = 2;

/** A booking older than this is never asked (stale, spammy). */
export const REVIEW_REQUEST_MAX_AGE_HOURS = 26;

export function isEligibleForReviewRequest(
  reservation: Pick<ReviewRequestReservation, 'status' | 'reviewRequestSent' | 'date'>,
  now: Date
): boolean {
  if (reservation.reviewRequestSent) return false;
  if (reservation.status !== 'confirmed' && reservation.status !== 'completed') return false;

  const ageMs = now.getTime() - reservation.date.getTime();
  if (ageMs < 0) return false; // booking in the future

  const minAgeMs = REVIEW_REQUEST_DELAY_HOURS * 60 * 60 * 1000;
  const maxAgeMs = REVIEW_REQUEST_MAX_AGE_HOURS * 60 * 60 * 1000;
  return ageMs >= minAgeMs && ageMs <= maxAgeMs;
}

/**
 * Google review deep link for the tenant's place: opens the review composer
 * directly (search.google.com/local/writereview?placeid=…) instead of the
 * listing, removing every step between the ask and the stars.
 */
export function buildGoogleReviewLink(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

/**
 * The ask. Short, warm, one clear action, POPIA-friendly (no pressure, the
 * customer can simply not reply, and STOP still opts them out globally).
 */
export function generateReviewRequestMessage(customerName: string | null, reviewLink: string): string {
  const name = customerName?.trim();
  const greeting = name ? `Hi ${name}` : 'Hi there';
  return (
    `${greeting}, thank you for dining with us tonight! We'd love to hear about your experience. ` +
    `Would you mind leaving us a Google review? ${reviewLink}`
  );
}
