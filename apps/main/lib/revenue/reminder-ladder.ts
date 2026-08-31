/**
 * O2 — booking reminder ladder (48h / 24h / 6h): pure decision logic.
 *
 * PRD Gate O2: "15–20% no-shows kill Friday revenue. Booking drafts
 * (30-min TTL), CONFIRM/YES flows, reminders at 48h/24h/6h, CANCEL/
 * RESCHEDULE self-service." This module owns the reminder ladder and the
 * CONFIRM flow's decision core; cancellation self-service already exists
 * (lib/ai/cancel-intent.ts).
 *
 * Window design: the rungs' firing windows are DISJOINT —
 *   48h rung fires while 24h < time-until ≤ 48h
 *   24h rung fires while  6h < time-until ≤ 24h
 *    6h rung fires while  0  < time-until ≤  6h
 * A booking made 12 hours out therefore gets exactly one 24h-rung reminder
 * (never a pointless "48 hours to go" after the fact), and a booking made
 * 3 hours out gets only the 6h nudge. At most three reminders per booking,
 * one per rung, each exactly once.
 *
 * Pure and framework-free like lib/revenue/no-show.ts; the Drizzle adapter
 * lives in ./reminder-ladder-store.ts, the cron boundary in
 * app/api/cron/booking-reminders/route.ts.
 */

const MS_PER_HOUR = 3_600_000;

export const REMINDER_RUNGS = [48, 24, 6] as const;
export type ReminderRung = (typeof REMINDER_RUNGS)[number];

/** How far ahead the scan looks (the largest rung). */
export const REMINDER_WINDOW_HOURS: ReminderRung = 48;

export const DEFAULT_REMINDER_LIMIT = 100;

const RUNG_SENT_FIELD: Record<ReminderRung, 'reminder48SentAt' | 'reminder24SentAt' | 'reminder6SentAt'> = {
  48: 'reminder48SentAt',
  24: 'reminder24SentAt',
  6: 'reminder6SentAt',
};

/** The sent-at column for a rung — shared with the store's atomic claim. */
export function rungSentField(rung: ReminderRung): 'reminder48SentAt' | 'reminder24SentAt' | 'reminder6SentAt' {
  return RUNG_SENT_FIELD[rung];
}

export interface ReminderCandidate {
  id: string;
  tenantId: string;
  restaurantName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  contactId: string | null;
  conversationId: string | null;
  reservationDate: Date;
  partySize: number;
  reminder48SentAt: Date | null;
  reminder24SentAt: Date | null;
  reminder6SentAt: Date | null;
}

export interface ReminderRecipient {
  to: string;
  waAccountId: string;
  name: string | null;
}

export type RungReadiness =
  | 'due'
  | 'already_sent'
  | 'not_yet_in_window'
  | 'reservation_passed';

/**
 * Is this rung due for a booking? `sentAt` short-circuits before the window
 * math: once a rung has fired it never fires again, even if the reservation
 * is edited into a different window.
 */
export function rungReadiness(
  rung: ReminderRung,
  reservationDate: Date,
  now: Date,
  sentAt: Date | null
): RungReadiness {
  const msUntil = reservationDate.getTime() - now.getTime();
  if (msUntil <= 0) return 'reservation_passed';
  if (sentAt) return 'already_sent';
  // The rung below this one bounds the window from underneath.
  const lowerHours = REMINDER_RUNGS.find((r) => r < rung) ?? 0;
  const inWindow = msUntil <= rung * MS_PER_HOUR && msUntil > lowerHours * MS_PER_HOUR;
  return inWindow ? 'due' : 'not_yet_in_window';
}

/**
 * The single rung this booking is owed right now, or null. Windows are
 * disjoint by construction, so at most one rung can answer 'due'; the scan
 * order (most urgent first) merely makes that explicit.
 */
export function dueRung(candidate: ReminderCandidate, now: Date): ReminderRung | null {
  for (const rung of [6, 24, 48] as ReminderRung[]) {
    const sentAt = candidate[rungSentField(rung)];
    if (rungReadiness(rung, candidate.reservationDate, now, sentAt) === 'due') return rung;
  }
  return null;
}

/** The scan window [now, now + windowHours] the store queries. */
export function reminderScanWindow(now: Date): { from: Date; to: Date } {
  return { from: now, to: new Date(now.getTime() + REMINDER_WINDOW_HOURS * MS_PER_HOUR) };
}

function formatReservationMoment(date: Date): string {
  return new Date(date).toLocaleString('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * The reminder copy. Always carries both self-service exits (CONFIRM and
 * CANCEL) so the guest never needs to call the restaurant.
 */
export function buildReminderMessage(input: {
  restaurantName: string | null;
  customerName: string | null;
  reservationDate: Date;
  partySize: number;
  rungHours: ReminderRung;
  now: Date;
}): string {
  const name = input.customerName?.trim() || 'there';
  const restaurant = input.restaurantName?.trim() || 'us';
  const when = formatReservationMoment(input.reservationDate);
  const lead =
    input.rungHours >= 48
      ? 'Your table is coming up this week'
      : input.rungHours >= 24
        ? 'A friendly reminder about tomorrow'
        : 'See you soon';
  return (
    `${lead}, ${name}! 🍽️\n\n` +
    `Your table for *${input.partySize}* at ${restaurant} is booked for ${when}.\n\n` +
    `Reply *CONFIRM* to keep your booking, or *CANCEL* if your plans changed — no call needed.`
  );
}

/** Reply to a guest's CONFIRM/YES. */
export function buildConfirmationReply(input: {
  restaurantName: string | null;
  reservationDate: Date | null;
  partySize: number | null;
}): string {
  const restaurant = input.restaurantName?.trim() || 'the restaurant';
  if (!input.reservationDate) {
    return (
      `Thanks for confirming! We couldn't find an upcoming booking under your number, but we've noted your reply. ` +
      `If you'd like to book a table, just tell us the date, time and number of guests.`
    );
  }
  const when = formatReservationMoment(input.reservationDate);
  const party = input.partySize ? ` for *${input.partySize}*` : '';
  return (
    `Perfect — you're confirmed! ✅\n\n` +
    `Your table${party} at ${restaurant} is locked in for ${when}.\n\n` +
    `We can't wait to host you. Reply *CANCEL* anytime if your plans change.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron runner
// ─────────────────────────────────────────────────────────────────────────────

export interface ReminderStore {
  /**
   * Confirmed future bookings inside the scan window. Implementations must
   * also exclude opted-out contacts (POPIA), AI-off / manual-mode tenants,
   * and conversations under manual takeover.
   */
  findReminderCandidates(input: { from: Date; to: Date; limit: number }): Promise<ReminderCandidate[]>;
  /**
   * Atomically claim a rung: true only when this call was the one that
   * flipped the NULL. Overlapping cron runs see false and skip.
   */
  claimReminderRung(reservationId: string, rung: ReminderRung, sentAt: Date): Promise<boolean>;
  /** Resolve the destination; null = cannot message (row stays unclaimed-safe). */
  findRecipient(candidate: ReminderCandidate): Promise<ReminderRecipient | null>;
  /** Hand the message to the outbox, which owns retries and delivery state. */
  queueReminder(input: { tenantId: string; waAccountId: string; to: string; text: string }): Promise<void>;
}

export interface ReminderCronOptions {
  now?: Date;
  limit?: number;
  /** Billing gate predicate — production wires the real gate; tests omit it. */
  isSendable?: (tenantId: string) => Promise<boolean> | boolean;
}

export interface ReminderCronSummary {
  scanned: number;
  sent: number;
  skipped: {
    notDue: number;
    alreadySent: number;
    noRecipient: number;
    billingBlocked: number;
    failed: number;
  };
  samples: { reservationId: string; tenantId: string; rung: ReminderRung }[];
}

/**
 * One cron run: for every confirmed booking in the next 48h, send the one
 * reminder it is owed (if any) via the outbox. Rung is claimed BEFORE
 * queueing (a claimed-but-unqueued row loses that rung's reminder — the
 * safe direction versus double-messaging), and per-row errors never abort
 * the batch.
 */
export async function runReminderCron(
  store: ReminderStore,
  options: ReminderCronOptions = {}
): Promise<ReminderCronSummary> {
  const now = options.now ?? new Date();
  const limit =
    options.limit && options.limit > 0 ? options.limit : DEFAULT_REMINDER_LIMIT;

  const summary: ReminderCronSummary = {
    scanned: 0,
    sent: 0,
    skipped: { notDue: 0, alreadySent: 0, noRecipient: 0, billingBlocked: 0, failed: 0 },
    samples: [],
  };

  const { from, to } = reminderScanWindow(now);
  const candidates = await store.findReminderCandidates({ from, to, limit });
  summary.scanned = candidates.length;

  for (const candidate of candidates) {
    const rung = dueRung(candidate, now);
    if (!rung) {
      // Either the next window hasn't opened or every applicable rung
      // already fired — both are the steady state between rungs.
      const anyDueWindow =
        candidate.reservationDate.getTime() > now.getTime() &&
        (candidate.reminder48SentAt || candidate.reminder24SentAt || candidate.reminder6SentAt);
      summary.skipped[anyDueWindow ? 'alreadySent' : 'notDue'] += 1;
      continue;
    }

    if (options.isSendable) {
      let allowed: boolean;
      try {
        allowed = await options.isSendable(candidate.tenantId);
      } catch {
        allowed = false;
      }
      if (!allowed) {
        summary.skipped.billingBlocked += 1;
        continue;
      }
    }

    // Resolve the recipient BEFORE claiming: a row with no route (no
    // connected WhatsApp account yet) must stay claimable for the next run.
    let recipient: ReminderRecipient | null = null;
    try {
      recipient = await store.findRecipient(candidate);
    } catch (err) {
      console.error(`[Reminders] Recipient resolution failed for ${candidate.id}`, err);
      summary.skipped.failed += 1;
      continue;
    }
    if (!recipient) {
      summary.skipped.noRecipient += 1;
      continue;
    }

    let claimed: boolean;
    try {
      claimed = await store.claimReminderRung(candidate.id, rung, now);
    } catch (err) {
      console.error(`[Reminders] Claim failed for ${candidate.id}`, err);
      summary.skipped.failed += 1;
      continue;
    }
    if (!claimed) {
      // A concurrent run already took this rung.
      summary.skipped.alreadySent += 1;
      continue;
    }

    try {
      await store.queueReminder({
        tenantId: candidate.tenantId,
        waAccountId: recipient.waAccountId,
        to: recipient.to,
        text: buildReminderMessage({
          restaurantName: candidate.restaurantName,
          customerName: recipient.name ?? candidate.customerName,
          reservationDate: candidate.reservationDate,
          partySize: candidate.partySize,
          rungHours: rung,
          now,
        }),
      });
    } catch (err) {
      console.error(`[Reminders] Queue failed for ${candidate.id}`, err);
      summary.skipped.failed += 1;
      continue;
    }

    summary.sent += 1;
    if (summary.samples.length < 5) {
      summary.samples.push({ reservationId: candidate.id, tenantId: candidate.tenantId, rung });
    }
  }

  return summary;
}
