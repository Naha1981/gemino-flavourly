/**
 * Gate #4 — No-Show Monitoring (Revenue Intelligence Engine).
 *
 * A customer books a table, never arrives, and the restaurant only notices
 * when the table sits empty at 21:00. Two hours after a confirmed booking's
 * start time has passed without the customer showing up, this module sends
 * one WhatsApp message offering to rebook:
 *
 *   Hi Thabo, we missed you tonight! We still have tables available this
 *   Saturday. Would you like to rebook?
 *
 * ── One cron run, two phases ───────────────────────────────────────────
 *
 * The cron runs every 30 minutes and does detection and follow-up in the
 * same invocation, in that order:
 *
 *   Phase 1 DETECT: stamp `no_show_detected` / `no_show_detected_at` on
 *   confirmed bookings whose start time is past the detection cutoff.
 *
 *   Phase 2 FOLLOW-UP: message bookings detected more than 2 hours ago
 *   whose follow-up has not been sent, then stamp
 *   `no_show_followup_sent` / `no_show_followup_sent_at`.
 *
 * A booking detected in phase 1 of a run is never messaged in phase 2 of
 * the same run: its `no_show_detected_at` is the current instant, which
 * cannot be older than "2 hours ago". The 2-hour gap between detection
 * and the message is what keeps "we missed you tonight!" from arriving
 * while the customer is still finding parking.
 *
 * ── The detection cutoff ───────────────────────────────────────────────
 *
 * A booking is a no-show candidate once it is more than `GRACE_HOURS`
 * (2) past its start time, OR once its calendar day has fully rolled
 * over — whichever happens first:
 *
 *   cutoff = max(startOfToday(now), now − 2h);   date < cutoff
 *
 * This is exactly the scan "date < today OR (date = today AND time <
 * now − 2h)" collapsed into one comparison, and it matters at the midnight
 * boundary: a 23:30 booking checked at 00:30 has not crossed its 2-hour
 * grace (that is 01:30), but the day it belonged to is over, so it is
 * detected immediately rather than 1.5 hours late. Before 02:00 the
 * cutoff is start-of-today; after 02:00 it is now − 2h.
 *
 * ── What detection does NOT do ─────────────────────────────────────────
 *
 * Detection never flips `status` to 'no_show'. The flags are the cron's
 * own bookkeeping; the book on the dashboard stays the staff's to run,
 * because a "no-show" customer who walks in 20 minutes late and gets
 * marked 'completed' must never receive "we missed you tonight!". The
 * follow-up scan therefore also requires status = 'confirmed' at message
 * time, not just at detection time.
 *
 * ── Idempotency ────────────────────────────────────────────────────────
 *
 * Both dedup flags live on the reservation row and are flipped as soon as
 * the work is done (stamp on detection; stamp when the message is handed
 * to the outbox) — not when WhatsApp confirms delivery. Deduplicating on
 * the queue instead would let the outbox's own retries produce a second
 * "we missed you", which is the one failure mode a customer notices.
 *
 * A reservation whose recipient cannot be resolved (no connected WhatsApp
 * account, no phone number) is left unmarked so the next run retries,
 * matching Gate #3's reasoning.
 *
 * ── Who gets detected and messaged ─────────────────────────────────────
 *
 * The Drizzle store filters out, in SQL, opted-out contacts
 * (`contacts.blocklisted`, the POPIA "STOP" path), tenants with AI
 * disabled or in manual mode, conversations under manual takeover (staff
 * are already talking to that customer — an automated message alongside
 * them would read as surveillance), and — at follow-up time — bookings
 * staff have since marked 'completed' or 'cancelled'. The cron logic then
 * re-validates every predicate it owns (status, flags, windows) on each
 * row the query returns; a too-wide query can widen the scan but never
 * the blast radius.
 *
 * Framework-free, like ./classify.ts, ./cron.ts and
 * ./cancellation-followup.ts: the Drizzle adapter lives in
 * ./no-show-store.ts so this can be unit-tested with a fake store.
 */

import { DAY_NAMES } from './slow-days.ts';

/** Grace period after a booking's start time before it is a no-show. */
export const NOSHOW_GRACE_HOURS = 2;
/** Wait this long after detection before offering to rebook. */
export const NOSHOW_FOLLOWUP_DELAY_HOURS = 2;
/** Reservations handled per phase per cron run. */
export const DEFAULT_NOSHOW_LIMIT = 50;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
/** `Date.getUTCDay()` value the rebooking offer targets: the big night. */
export const WEEKEND_OFFER_DAY = 6;

/** A confirmed booking the detection scan picked up. */
export interface NoShowCandidate {
  id: string;
  tenantId: string;
  customerName: string | null;
  customerPhone: string | null;
  contactId: string | null;
  conversationId: string | null;
  /** Re-validated by the cron; must still be 'confirmed'. */
  status: string;
  /** When the table was for. */
  reservationDate: Date;
  partySize: number;
  /** Re-validated by the cron; must still be false. */
  noShowDetected: boolean;
}

/** A booking the follow-up scan picked up. */
export interface NoShowFollowupCandidate extends NoShowCandidate {
  /** When the no-show was detected; delay is measured from this. */
  noShowDetectedAt: Date | null;
  /** Re-validated by the cron; must still be false. */
  noShowFollowupSent: boolean;
}

/** Where and how to reach the customer. */
export interface NoShowRecipient {
  /** Destination phone number. */
  to: string;
  waAccountId: string;
  /** Name to greet with, or null to fall back to "there". */
  name: string | null;
}

export interface NoShowStore {
  /**
   * Confirmed, unflagged bookings whose start time is before `cutoff`.
   * Implementations must also exclude opted-out contacts, AI-off and
   * manual-mode tenants, and conversations under manual takeover.
   */
  findNoShowCandidates(input: { cutoff: Date; limit: number }): Promise<NoShowCandidate[]>;
  /** Record that this booking is a no-show as of `detectedAt`. */
  markNoShowDetected(reservationId: string, detectedAt: Date): Promise<void>;
  /**
   * Flagged bookings detected before `detectedBefore` whose follow-up has
   * not been sent. Same exclusions as the detection scan, plus the booking
   * must still be 'confirmed' (a late arrival marked 'completed' in the
   * 2-hour gap must never be told we missed them).
   */
  findDueFollowups(input: { detectedBefore: Date; limit: number }): Promise<NoShowFollowupCandidate[]>;
  /** Resolve the contact/conversation to a destination. Null = cannot message. */
  findRecipient(reservation: NoShowFollowupCandidate): Promise<NoShowRecipient | null>;
  /** Hand the message to the outbox, which owns delivery and retries. */
  queueFollowup(input: { tenantId: string; waAccountId: string; to: string; text: string }): Promise<void>;
  /** Record that this booking's follow-up has been sent. */
  markFollowupSent(reservationId: string, sentAt: Date): Promise<void>;
}

export interface NoShowCronOptions {
  /** Reference "now"; the cron injects it so tests can move time. */
  now?: Date;
  graceHours?: number;
  followupDelayHours?: number;
  limit?: number;
}

export type DetectionEligibility = 'detect' | 'not_confirmed' | 'already_detected' | 'too_early';

export type FollowupReadiness = 'due' | 'not_confirmed' | 'already_sent' | 'never_detected' | 'not_yet_due';

export interface NoShowCronSummary {
  detection: {
    scanned: number;
    detected: number;
    skipped: { notConfirmed: number; alreadyDetected: number; tooEarly: number; failed: number };
    samples: Array<{ reservationId: string; tenantId: string; reservationDate: string }>;
  };
  followup: {
    scanned: number;
    sent: number;
    skipped: {
      notConfirmed: number;
      notYetDue: number;
      alreadySent: number;
      neverDetected: number;
      noRecipient: number;
      failed: number;
    };
    samples: Array<{ reservationId: string; to: string; text: string }>;
  };
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Midnight UTC on the calendar day containing `date`. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The detection cutoff for a given "now": the LATER of start-of-today and
 * now − graceHours. A booking is detectable when its start time is
 * strictly before this instant.
 *
 * Proven equivalent to "date < today OR (date = today AND time < now −
 * grace)" for every minute of a 97-hour sweep in ./no-show.test.ts. The
 * start-of-today arm is what catches the 23:30-booked → 00:30-checked
 * edge at the day rollover instead of 1.5 hours later.
 */
export function computeDetectionCutoff(
  now: Date = new Date(),
  options: { graceHours?: number } = {}
): Date {
  const graceHours = positive(options.graceHours, NOSHOW_GRACE_HOURS);
  const graceCutoff = new Date(now.getTime() - graceHours * MS_PER_HOUR);
  const dayStart = startOfUtcDay(now);
  return dayStart.getTime() > graceCutoff.getTime() ? dayStart : graceCutoff;
}

/**
 * Should this row be stamped as a no-show right now?
 *
 * The store query already applies the same predicates; re-checking them
 * here (defense in depth) is what keeps a too-wide query — or a hand-rolled
 * caller — from flagging a completed booking, re-flagging a detected one,
 * or flagging a booking whose grace period is still running.
 */
export function detectionEligibility(
  candidate: Pick<NoShowCandidate, 'status' | 'noShowDetected' | 'reservationDate'>,
  options: NoShowCronOptions = {}
): DetectionEligibility {
  const now = options.now ?? new Date();
  if (candidate.status !== 'confirmed') return 'not_confirmed';
  if (candidate.noShowDetected) return 'already_detected';
  if (candidate.reservationDate.getTime() >= computeDetectionCutoff(now, options).getTime()) {
    return 'too_early';
  }
  return 'detect';
}

/**
 * Is this detected booking's rebooking offer due right now?
 *
 * Same defense-in-depth rule as detectionEligibility: every predicate the
 * store query applies is re-checked against the row itself, so the message
 * can only ever go out for a booking that is still 'confirmed', was
 * detected more than followupDelayHours ago, and has not been sent yet.
 * A late arrival flipped to 'completed' during the 2-hour gap stops here.
 */
export function followupReadiness(
  candidate: Pick<NoShowFollowupCandidate, 'status' | 'noShowDetectedAt' | 'noShowFollowupSent'>,
  options: NoShowCronOptions = {}
): FollowupReadiness {
  const now = options.now ?? new Date();
  const delayHours = positive(options.followupDelayHours, NOSHOW_FOLLOWUP_DELAY_HOURS);
  if (candidate.status !== 'confirmed') return 'not_confirmed';
  if (candidate.noShowFollowupSent) return 'already_sent';
  if (!candidate.noShowDetectedAt) return 'never_detected';
  const dueBefore = new Date(now.getTime() - delayHours * MS_PER_HOUR);
  // Strict, matching the scan's `no_show_detected_at < NOW() - 2h`: exactly
  // 2 hours after detection is not yet due.
  if (candidate.noShowDetectedAt.getTime() >= dueBefore.getTime()) return 'not_yet_due';
  return 'due';
}

/**
 * The Saturday the rebooking offer points at: the next one strictly after
 * start-of-today, i.e. 1 to 7 days out. A Friday-night no-show is offered
 * the Saturday right after; a Saturday-night no-show is offered next
 * week's, since tonight's has already been missed. (Same scan shape as
 * Gate #3's nextOccurrenceOfWeekday.)
 */
export function nextWeekendDate(now: Date): Date {
  const start = startOfUtcDay(now);
  for (let i = 1; i <= 7; i += 1) {
    const candidate = new Date(start.getTime() + i * MS_PER_DAY);
    if (candidate.getUTCDay() === WEEKEND_OFFER_DAY) return candidate;
  }
  /* c8 ignore next -- a 7-day scan always crosses a Saturday */
  return start;
}

/**
 * The follow-up copy. The offer is always the upcoming Saturday — the big
 * night — computed from send time so it is never a date in the past.
 */
export function buildNoShowFollowupMessage(input: { customerName?: string | null; now: Date }): string {
  const name = input.customerName?.trim() || 'there';
  const weekday = DAY_NAMES[nextWeekendDate(input.now).getUTCDay()];
  return `Hi ${name}, we missed you tonight! We still have tables available this ${weekday}. Would you like to rebook?`;
}

/**
 * One cron run: flag the no-shows that crossed their grace period, then
 * send the rebooking offers whose 2-hour delay has elapsed.
 */
export async function runNoShowCron(
  store: NoShowStore,
  options: NoShowCronOptions = {}
): Promise<NoShowCronSummary> {
  const now = options.now ?? new Date();
  const limit = positive(options.limit, DEFAULT_NOSHOW_LIMIT);

  const summary: NoShowCronSummary = {
    detection: {
      scanned: 0,
      detected: 0,
      skipped: { notConfirmed: 0, alreadyDetected: 0, tooEarly: 0, failed: 0 },
      samples: [],
    },
    followup: {
      scanned: 0,
      sent: 0,
      skipped: { notConfirmed: 0, notYetDue: 0, alreadySent: 0, neverDetected: 0, noRecipient: 0, failed: 0 },
      samples: [],
    },
  };

  // ── Phase 1: DETECT ─────────────────────────────────────────────────
  const cutoff = computeDetectionCutoff(now, options);
  const candidates = await store.findNoShowCandidates({ cutoff, limit });
  summary.detection.scanned = candidates.length;

  for (const candidate of candidates) {
    const eligibility = detectionEligibility(candidate, { ...options, now });
    if (eligibility !== 'detect') {
      summary.detection.skipped[
        eligibility === 'not_confirmed' ? 'notConfirmed' : eligibility === 'already_detected' ? 'alreadyDetected' : 'tooEarly'
      ] += 1;
      continue;
    }

    try {
      await store.markNoShowDetected(candidate.id, now);
    } catch (err) {
      // One bad row must not abort the batch; unflagged means the next run
      // tries again.
      summary.detection.skipped.failed += 1;
      console.error(`[No-Show] Failed to flag reservation ${candidate.id} as a no-show`, err);
      continue;
    }

    summary.detection.detected += 1;
    if (summary.detection.samples.length < 5) {
      summary.detection.samples.push({
        reservationId: candidate.id,
        tenantId: candidate.tenantId,
        reservationDate: candidate.reservationDate.toISOString(),
      });
    }
  }

  // ── Phase 2: FOLLOW-UP ───────────────────────────────────────────────
  const followupDelayHours = positive(options.followupDelayHours, NOSHOW_FOLLOWUP_DELAY_HOURS);
  const detectedBefore = new Date(now.getTime() - followupDelayHours * MS_PER_HOUR);
  const due = await store.findDueFollowups({ detectedBefore, limit });
  summary.followup.scanned = due.length;

  for (const candidate of due) {
    const readiness = followupReadiness(candidate, { ...options, now });
    if (readiness !== 'due') {
      summary.followup.skipped[
        readiness === 'not_confirmed'
          ? 'notConfirmed'
          : readiness === 'already_sent'
            ? 'alreadySent'
            : readiness === 'never_detected'
              ? 'neverDetected'
              : 'notYetDue'
      ] += 1;
      continue;
    }

    const recipient = await store.findRecipient(candidate);
    if (!recipient?.to || !recipient.waAccountId) {
      // Left unmarked on purpose: a disconnected WhatsApp account should
      // not silently cost the customer their rebooking offer.
      summary.followup.skipped.noRecipient += 1;
      continue;
    }

    const text = buildNoShowFollowupMessage({
      customerName: recipient.name ?? candidate.customerName,
      now,
    });

    try {
      await store.queueFollowup({
        tenantId: candidate.tenantId,
        waAccountId: recipient.waAccountId,
        to: recipient.to,
        text,
      });
    } catch (err) {
      // Not marked sent, so the next run tries again rather than losing
      // the offer — one bad row must not abort the batch either.
      summary.followup.skipped.failed += 1;
      console.error(`[No-Show] Failed to queue follow-up for reservation ${candidate.id}`, err);
      continue;
    }

    await store.markFollowupSent(candidate.id, now);
    summary.followup.sent += 1;
    if (summary.followup.samples.length < 5) {
      summary.followup.samples.push({ reservationId: candidate.id, to: recipient.to, text });
    }
  }

  return summary;
}
