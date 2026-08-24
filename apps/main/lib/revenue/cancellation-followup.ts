/**
 * Gate #3 — Cancellation Follow-Up (Revenue Intelligence Engine).
 *
 * A customer cancels a table. A day later they have usually already eaten
 * somewhere else, and the restaurant has lost the booking without ever
 * hearing why. This module sends one WhatsApp message 24 hours after a
 * cancellation, offering the same weekday again:
 *
 *   Hi Thabo, sorry we missed you! We still have tables available this
 *   Tuesday. Would you like to rebook?
 *
 * ── Why 24h, and why a 7-day ceiling ───────────────────────────────────
 *
 * Sooner than 24 hours reads as surveillance; later than a week the offer
 * is stale and the customer has moved on. The upper bound also caps the
 * blast radius of a bug or a backfilled `cancelled_at`: no cancellation
 * older than 7 days can ever be messaged, however many cron runs happen.
 *
 * ── Idempotency ────────────────────────────────────────────────────────
 *
 * The cron runs every 6 hours, so the same row is scanned repeatedly.
 * `cancellation_followup_sent` is flipped on the reservation as soon as the
 * message is handed to the outbox — not when WhatsApp confirms delivery.
 * Deduplicating on the queue instead would let the outbox's own retries
 * produce a second "sorry we missed you", which is the one failure mode a
 * customer actually notices.
 *
 * A reservation whose recipient cannot be resolved (no connected WhatsApp
 * account, no phone number) is left unmarked rather than marked-and-
 * dropped, so it is retried on the next run; the 7-day ceiling bounds how
 * long that can go on.
 *
 * ── Who gets messaged ──────────────────────────────────────────────────
 *
 * The Drizzle store filters out opted-out contacts (`contacts.blocklisted`,
 * set by the POPIA "STOP" path) and tenants with AI disabled or in manual
 * mode, matching the inbound webhook's rules. An automated marketing
 * message to someone who unsubscribed would be a compliance bug, not a
 * conversion.
 *
 * Framework-free, like ./classify.ts and ./cron.ts: the Drizzle adapter
 * lives in the cron route so this can be unit-tested with a fake store.
 */

import { DAY_NAMES } from './slow-days.ts';

/** Wait this long after a cancellation before following up. */
export const FOLLOWUP_DELAY_HOURS = 24;
/** Never follow up on a cancellation older than this. */
export const FOLLOWUP_MAX_AGE_DAYS = 7;
/** Reservations handled per cron run. */
export const DEFAULT_FOLLOWUP_LIMIT = 50;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** A cancelled reservation, as read by the follow-up scan. */
export interface CancelledReservation {
  id: string;
  tenantId: string;
  customerName: string | null;
  customerPhone: string | null;
  contactId: string | null;
  conversationId: string | null;
  /** When the table was for — its weekday is what we offer again. */
  reservationDate: Date;
  partySize: number;
  /** When the cancellation was recorded. */
  cancelledAt: Date;
}

/** Where and how to reach the customer. */
export interface FollowupRecipient {
  /** Destination phone number. */
  to: string;
  waAccountId: string;
  /** Name to greet with, or null to fall back to "there". */
  name: string | null;
}

export interface CancellationFollowupStore {
  /**
   * Cancelled reservations whose follow-up is due.
   *
   * Both bounds are exclusive of rows outside them: `cancelledBefore` is
   * "cancelled more than 24h ago", `cancelledAfter` is "cancelled less than
   * 7 days ago". Implementations must also exclude opted-out contacts and
   * tenants that must not be auto-messaged.
   */
  findDueCancellations(input: {
    cancelledBefore: Date;
    cancelledAfter: Date;
    limit: number;
  }): Promise<CancelledReservation[]>;
  /** Resolve the contact/conversation to a destination. Null = cannot message. */
  findRecipient(reservation: CancelledReservation): Promise<FollowupRecipient | null>;
  /** Hand the message to the outbox, which owns delivery and retries. */
  queueFollowup(input: { tenantId: string; waAccountId: string; to: string; text: string }): Promise<void>;
  /** Record that this reservation's follow-up has been sent. */
  markFollowupSent(reservationId: string, sentAt: Date): Promise<void>;
  /**
   * Record a cancellation: status = 'cancelled' plus the timestamp the
   * follow-up window is measured from.
   *
   * Nothing in the app cancelled reservations before Gate #3, so nothing
   * stamped `cancelled_at`. Every cancellation path — staff UI, AI
   * responder, import script — must go through here or its cancellations
   * will never be followed up.
   */
  cancelReservation(reservationId: string, cancelledAt: Date): Promise<void>;
}

export interface CancellationFollowupOptions {
  /** Reference "now"; the cron injects it so tests can move time. */
  now?: Date;
  delayHours?: number;
  maxAgeDays?: number;
  limit?: number;
}

export interface CancellationWindow {
  /** Cancelled before this instant = old enough to follow up. */
  cancelledBefore: Date;
  /** Cancelled after this instant = recent enough to still be worth it. */
  cancelledAfter: Date;
}

export interface CancellationFollowupSummary {
  scanned: number;
  sent: number;
  skipped: { notYetDue: number; tooOld: number; noRecipient: number; failed: number };
  samples: Array<{ reservationId: string; to: string; text: string }>;
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The cancellation window for a given "now": 24h ago back to 7 days ago. */
export function computeCancellationWindow(
  now: Date = new Date(),
  options: { delayHours?: number; maxAgeDays?: number } = {}
): CancellationWindow {
  const delayHours = positive(options.delayHours, FOLLOWUP_DELAY_HOURS);
  const maxAgeDays = positive(options.maxAgeDays, FOLLOWUP_MAX_AGE_DAYS);
  return {
    cancelledBefore: new Date(now.getTime() - delayHours * MS_PER_HOUR),
    cancelledAfter: new Date(now.getTime() - maxAgeDays * MS_PER_DAY),
  };
}

export type FollowupEligibility = 'due' | 'not_yet_due' | 'too_old';

/**
 * Is this cancellation in the follow-up window?
 *
 * The store query already applies the same bounds; re-checking here keeps a
 * too-wide query (or a hand-rolled caller) from messaging someone it should
 * not, and it is what makes the window unit-testable without a database.
 */
export function followupEligibility(
  reservation: Pick<CancelledReservation, 'cancelledAt'>,
  options: CancellationFollowupOptions = {}
): FollowupEligibility {
  const now = options.now ?? new Date();
  const window = computeCancellationWindow(now, options);
  const at = reservation.cancelledAt.getTime();

  // Both bounds are strict, matching the gate's `cancelled_at < NOW() - 24h`
  // and `cancelled_at > NOW() - 7 days`: exactly 24h is not yet due, exactly
  // 7 days is already too old.
  if (at >= window.cancelledBefore.getTime()) return 'not_yet_due';
  if (at <= window.cancelledAfter.getTime()) return 'too_old';
  return 'due';
}

/**
 * The next date that falls on the same weekday as `reference`, strictly
 * after `now` — so a Tuesday booking cancelled on a Monday offers "this
 * Tuesday" (tomorrow), never a date that has already passed.
 */
export function nextOccurrenceOfWeekday(reference: Date, now: Date): Date {
  const target = reference.getUTCDay();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  for (let i = 1; i <= 7; i += 1) {
    const candidate = new Date(start.getTime() + i * MS_PER_DAY);
    if (candidate.getUTCDay() === target) return candidate;
  }
  /* c8 ignore next -- a 7-day scan always finds the weekday */
  return start;
}

/**
 * The follow-up copy. Weekday comes from the cancelled reservation, so the
 * offer matches the night the customer actually wanted.
 */
export function buildFollowupMessage(input: {
  customerName?: string | null;
  reservationDate: Date;
  now: Date;
}): string {
  const name = input.customerName?.trim() || 'there';
  const offered = nextOccurrenceOfWeekday(input.reservationDate, input.now);
  const weekday = DAY_NAMES[offered.getUTCDay()];
  return `Hi ${name}, sorry we missed you! We still have tables available this ${weekday}. Would you like to rebook?`;
}

/**
 * One cron run: find due cancellations, message each once, mark it sent.
 */
export async function runCancellationFollowupCron(
  store: CancellationFollowupStore,
  options: CancellationFollowupOptions = {}
): Promise<CancellationFollowupSummary> {
  const now = options.now ?? new Date();
  const limit = positive(options.limit, DEFAULT_FOLLOWUP_LIMIT);
  const window = computeCancellationWindow(now, options);

  const summary: CancellationFollowupSummary = {
    scanned: 0,
    sent: 0,
    skipped: { notYetDue: 0, tooOld: 0, noRecipient: 0, failed: 0 },
    samples: [],
  };

  const due = await store.findDueCancellations({
    cancelledBefore: window.cancelledBefore,
    cancelledAfter: window.cancelledAfter,
    limit,
  });
  summary.scanned = due.length;

  for (const reservation of due) {
    const eligibility = followupEligibility(reservation, { ...options, now });
    if (eligibility !== 'due') {
      summary.skipped[eligibility === 'too_old' ? 'tooOld' : 'notYetDue'] += 1;
      continue;
    }

    const recipient = await store.findRecipient(reservation);
    if (!recipient?.to || !recipient.waAccountId) {
      // Left unmarked on purpose: a disconnected WhatsApp account should not
      // silently cost the customer their follow-up, and the 7-day ceiling
      // bounds the retries.
      summary.skipped.noRecipient += 1;
      continue;
    }

    const text = buildFollowupMessage({
      customerName: recipient.name ?? reservation.customerName,
      reservationDate: reservation.reservationDate,
      now,
    });

    try {
      await store.queueFollowup({
        tenantId: reservation.tenantId,
        waAccountId: recipient.waAccountId,
        to: recipient.to,
        text,
      });
    } catch (err) {
      // Not marked sent, so the next run tries again rather than losing the
      // follow-up — one bad row must not abort the batch either.
      summary.skipped.failed += 1;
      console.error(`[Cancellation Follow-Up] Failed to queue follow-up for reservation ${reservation.id}`, err);
      continue;
    }

    await store.markFollowupSent(reservation.id, now);
    summary.sent += 1;
    if (summary.samples.length < 5) {
      summary.samples.push({ reservationId: reservation.id, to: recipient.to, text });
    }
  }

  return summary;
}

/**
 * Stamp a cancellation so the follow-up window can find it.
 *
 * The single entry point every cancellation path should use; flipping
 * `status` directly leaves `cancelled_at` NULL and the reservation is never
 * followed up.
 */
export async function markReservationCancelled(
  store: Pick<CancellationFollowupStore, 'cancelReservation'>,
  reservationId: string,
  cancelledAt: Date = new Date()
): Promise<void> {
  await store.cancelReservation(reservationId, cancelledAt);
}
