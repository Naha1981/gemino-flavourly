/**
 * Gate #3b — WhatsApp AI cancellation intent.
 *
 * Gate #3 gave the revenue engine a `cancelled_at` to follow up on, but the
 * only thing that stamped it was `markReservationCancelled()`, which nothing
 * in the app actually called: staff had no cancel control and the AI
 * responder had no cancel intent, so a customer texting "cancel my booking"
 * was answered with the generic booking-handler reply and the table was never
 * cancelled. This module closes that loop — it is the inbound path that lets
 * a customer cancel their OWN upcoming booking, stamping the cancellation
 * through the same `markReservationCancelled()` the Gate #3 cron reads.
 *
 * ── Two layers, and why both matter ────────────────────────────────────
 *
 * 1. `isCancellationRequest` — a narrow phrase matcher. It must fire on
 *    "cancel my booking" but NOT on "what's your cancellation policy?",
 *    "can I cancel if I need to?", or "cancel subscription" (the POPIA
 *    opt-out phrase). A bare substring match on "cancel" fails all three of
 *    those, so the matcher keys off specific multi-word requests instead.
 *
 * 2. `handleCancellationIntent` — the safety decision. Even after the
 *    matcher fires, a reservation is cancelled only when it belongs to THIS
 *    contact/phone in THIS tenant, is still `confirmed`, and is still in the
 *    future. The store is queried narrowly for performance, but the handler
 *    re-checks every predicate itself — the same defense-in-depth pattern as
 *    lib/revenue/cancellation-followup.ts, so a wrong query can never cancel
 *    a row the logic would not.
 *
 * Framework-free, like the revenue modules: the Drizzle adapter lives in
 * lib/ai/responder.ts (the only caller) so this file can be unit-tested with
 * a fake store and no database.
 */

// ---- 1. Matcher -----------------------------------------------------------

/**
 * Normalize a message for matching: lowercase, drop apostrophes (so
 * "can't" == "cant" and "what's" == "whats"), turn every other piece of
 * punctuation into a space, and collapse runs of whitespace. Case- and
 * punctuation-insensitive by construction.
 */
function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Canonical request phrases, pre-normalized (apostrophes already stripped). */
const CANCEL_REQUEST_PHRASES = [
  'cancel my booking',
  'cancel my reservation',
  'i need to cancel',
  'cant make it', // covers "can't make it" — the apostrophe is stripped first
].map(normalizePhrase);

/**
 * Does this inbound message read as a request to cancel a booking?
 *
 * Narrower than a bare substring on "cancel": it requires one of the concrete
 * request phrases, which keeps questions ("what's your cancellation policy?",
 * "can I cancel if I need to?") and the POPIA opt-out phrase ("cancel
 * subscription") from triggering a table cancellation. "cancel subscription"
 * is rejected twice — it contains no request phrase, and the subscription
 * guard keeps the POPIA opt-out path untouched even from phrasings like
 * "i need to cancel my subscription".
 */
export function isCancellationRequest(text: string): boolean {
  const normalized = normalizePhrase(text);
  if (!normalized) return false;
  // The POPIA "cancel subscription" opt-out path must stay untouched by this
  // intent; isOptOutMessage() in the responder handles it first regardless.
  if (normalized.includes('subscription')) return false;
  return CANCEL_REQUEST_PHRASES.some((phrase) => normalized.includes(phrase));
}

// ---- 2. Safety decision ---------------------------------------------------

/** Status mirror of reservations.status (kept in sync with the schema enum). */
export type ReservationStatus = 'confirmed' | 'cancelled' | 'completed' | 'no_show';

/** A reservation row as the cancel handler needs to see it. */
export interface CancelIntentReservation {
  id: string;
  tenantId: string;
  contactId: string | null;
  customerPhone: string | null;
  date: Date;
  partySize: number;
  status: ReservationStatus;
}

/**
 * What the handler needs from the data layer. Production narrows
 * `findCandidateReservations` to recent rows for performance; the handler
 * re-validates everything, so correctness never depends on the query.
 */
export interface CancelIntentStore {
  /** Is a human currently handling this thread? (defense in depth) */
  isManualTakeover(conversationId: string): Promise<boolean>;
  /** Reservations for this contact or phone in this tenant. */
  findCandidateReservations(input: {
    tenantId: string;
    contactId: string;
    phone: string;
  }): Promise<CancelIntentReservation[]>;
  /** Stamp the cancellation — in production this is markReservationCancelled(). */
  cancelReservation(reservationId: string, cancelledAt: Date): Promise<void>;
}

export interface CancelIntentInput {
  tenantId: string;
  contactId: string;
  phone: string;
  conversationId: string;
  /** Reference "now"; injected so tests can move time. */
  now?: Date;
}

/** Reply when no upcoming booking could be found for this sender. */
export const CANCEL_NOT_FOUND_MESSAGE =
  "I couldn't find an upcoming booking for this number. If you booked under a different number, message us and we'll sort it out.";

/**
 * The set of reservations this message is allowed to cancel. Every guard is
 * re-applied here rather than trusted to the store query: wrong tenant, wrong
 * contact/phone, non-confirmed status, or a date already in the past all drop
 * out here even if the query returned the row.
 *
 * "upcoming" means the reservation's datetime is at or after now — a table
 * booked for 18:00 is NOT upcoming at 20:00, so the comparison is against the
 * timestamp, not the calendar day.
 */
function isCancellable(
  reservation: CancelIntentReservation,
  input: { tenantId: string; contactId: string; phone: string },
  now: Date
): boolean {
  if (reservation.tenantId !== input.tenantId) return false;
  if (reservation.status !== 'confirmed') return false;
  if (reservation.date.getTime() < now.getTime()) return false;
  const contactMatch = reservation.contactId !== null && reservation.contactId === input.contactId;
  const phoneMatch = reservation.customerPhone !== null && reservation.customerPhone === input.phone;
  return contactMatch || phoneMatch;
}

/**
 * Resolve a cancellation request: find the customer's own upcoming booking,
 * stamp it cancelled through the single entry point the Gate #3 cron reads,
 * and reply.
 *
 * Returns the reply string, or `null` only when the thread is in manual
 * takeover (defense in depth — the webhook already suppresses AI during
 * takeover; this still never auto-cancels even if that guard were bypassed).
 */
export async function handleCancellationIntent(
  input: CancelIntentInput,
  store: CancelIntentStore
): Promise<string | null> {
  const now = input.now ?? new Date();

  if (await store.isManualTakeover(input.conversationId)) return null;

  const candidates = await store.findCandidateReservations({
    tenantId: input.tenantId,
    contactId: input.contactId,
    phone: input.phone,
  });

  // The most recent UPCOMING reservation is the next one in time (the future
  // date closest to now), so a customer with several bookings cancels the one
  // they obviously mean. Re-sorted here rather than trusted to the query.
  const upcoming = candidates
    .filter((reservation) => isCancellable(reservation, input, now))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const reservation = upcoming[0];
  if (!reservation) return CANCEL_NOT_FOUND_MESSAGE;

  await store.cancelReservation(reservation.id, now);
  return buildCancellationReply(reservation);
}

// ---- 3. Reply copy --------------------------------------------------------

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * The date/time shown in the cancellation reply, in UTC for determinism (the
 * revenue engine's weekday math is UTC too). Returned as pieces so the exact
 * wording can be unit-tested without re-implementing the formatter.
 */
export function formatReservationWhen(date: Date): { date: string; time: string } {
  return {
    date: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    time: `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`,
  };
}

/** The confirmation copy a customer sees the moment their table is cancelled. */
export function buildCancellationReply(
  reservation: Pick<CancelIntentReservation, 'partySize' | 'date'>
): string {
  const when = formatReservationWhen(reservation.date);
  return `Your table for ${reservation.partySize} on ${when.date} at ${when.time} is cancelled. Sorry to miss you — we'd love to host you another time.`;
}
