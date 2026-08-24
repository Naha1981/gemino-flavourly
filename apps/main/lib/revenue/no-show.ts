/**
 * Gate #4 — No-Show Monitoring (Revenue Intelligence Engine).
 *
 * A customer books a table and never shows. The restaurant finds out only
 * when the table sits empty, and by the next day the customer has usually
 * already eaten elsewhere. This module detects confirmed reservations that
 * passed without the customer arriving, waits two hours, then sends one
 * WhatsApp message offering to rebook:
 *
 *   Hi Thabo, we missed you tonight! We still have tables available this
 *   Saturday. Would you like to rebook?
 *
 * ── Two phases in one cron run (every 30 minutes) ─────────────────────
 *
 *   Phase 1 — DETECT: a confirmed booking whose date is strictly before
 *     the detection cutoff gets no_show_detected=true and
 *     no_show_detected_at=NOW(). The stamp is what the follow-up delay is
 *     measured from — never the booking time — so a reservation detected
 *     late (server down, backlog) is still messaged exactly two hours
 *     after detection, when "tonight" is still recent.
 *
 *   Phase 2 — FOLLOW-UP: no_show_detected_at older than 2 hours and not
 *     yet sent gets one rebook offer, routed through the booking's own
 *     tenant and WhatsApp account, then no_show_followup_sent=true.
 *
 * ── The detection cutoff, and the 23:30 edge ──────────────────────────
 *
 *   cutoff(now) = max(start of today, now − 2h); a booking is a no-show
 *   when its date is strictly before the cutoff.
 *
 *   The 2-hour grace is so a customer running late is not called a
 *   no-show while they might still walk in. But "now − 2h" alone breaks
 *   at the day boundary: a 23:30 booking checked at 00:30 is only 1 hour
 *   old, and a pure now − 2h cutoff would leave it undetected until 01:30.
 *   Taking the MAX with the start of today fixes that — once the booking's
 *   day has fully passed, the table is unambiguously empty. The equivalent
 *   two-clause form ("the booking's day is past, or it is today and at
 *   least 2 hours ago") is kept as isNoShowDueReference and pinned by a
 *   97-hour sweep in no-show.test.ts.
 *
 * ── Idempotency ───────────────────────────────────────────────────────
 *
 * The cron runs every 30 minutes, so the same row is scanned repeatedly.
 * `no_show_followup_sent` is flipped on the reservation as soon as the
 * message is handed to the outbox — not when WhatsApp confirms delivery.
 * Deduplication lives on the row, not on the queue: the outbox retries,
 * and a retried job must not produce a second "we missed you", which is
 * the one failure mode a customer actually notices.
 *
 * A reservation whose recipient cannot be resolved (no connected WhatsApp
 * account, no phone number) is left unmarked rather than marked-and-
 * dropped, so it is offered once the route exists.
 *
 * ── Who gets messaged ─────────────────────────────────────────────────
 *
 * The Drizzle store filters out opted-out contacts (`contacts.blocklisted`,
 * set by the POPIA "STOP" path), tenants with AI disabled, and tenants in
 * manual mode — matching the inbound webhook's rules. The scan also bows
 * out of conversations in manual takeover: staff is running that thread
 * and an automated offer would step on them. An automated marketing
 * message to someone who unsubscribed would be a compliance bug, not a
 * conversion.
 *
 * The handler below re-validates every predicate from the row itself
 * (defense in depth): a too-wide query, or a row that changed between the
 * SELECT and the loop, cannot message anyone it should not.
 *
 * Framework-free, like ./classify.ts, ./cron.ts and
 * ./cancellation-followup.ts: the Drizzle adapter lives in
 * ./no-show-store.ts so this can be unit-tested with a fake store.
 */

import { DAY_NAMES } from './slow-days.ts';

/** How long after the booked time passed before a no-show is detectable. */
export const DETECTION_GRACE_HOURS = 2;
/** How long after detection before the rebook offer goes out. */
export const FOLLOWUP_DELAY_HOURS = 2;
/** Reservations handled per cron run (per phase). */
export const DEFAULT_LIMIT = 50;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** A confirmed reservation, as read by the monitoring scans. */
export interface NoShowReservation {
  id: string;
  tenantId: string;
  customerName: string | null;
  customerPhone: string | null;
  contactId: string | null;
  conversationId: string | null;
  /** When the table was booked for. */
  reservationDate: Date;
  partySize: number;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  noShowDetected: boolean;
  /** When Phase 1 stamped the no-show; the follow-up delay is measured from here. */
  noShowDetectedAt: Date | null;
  noShowFollowupSent: boolean;
  noShowFollowupSentAt: Date | null;
  /** True when the linked conversation is in manual takeover (staff is running it). */
  manualTakeover: boolean;
}

/** Where and how to reach the customer. */
export interface NoShowFollowupRecipient {
  /** Destination phone number. */
  to: string;
  waAccountId: string;
  /** Name to greet with, or null to fall back to "there". */
  name: string | null;
}

export interface NoShowStore {
  /**
   * Phase 1 — confirmed reservations past the detection cutoff that have
   * not been stamped yet.
   *
   * Detection is a factual record of "the table passed, the customer did
   * not show": it is NOT filtered by tenant AI / manual mode / opt-out,
   * because recording a no-show costs the customer nothing. Those safety
   * filters apply to the follow-up scan, which is the only phase that
   * messages anyone.
   */
  findDetectable(input: { cutoff: Date; limit: number }): Promise<NoShowReservation[]>;
  /**
   * Phase 2 — detected no-shows whose 2-hour follow-up delay has elapsed
   * and whose offer has not gone out yet. Implementations must also
   * exclude opted-out contacts, tenants with AI disabled or in manual
   * mode, and conversations in manual takeover.
   */
  findFollowupDue(input: { detectedBefore: Date; limit: number }): Promise<NoShowReservation[]>;
  /** Resolve the contact/conversation to a destination. Null = cannot message. */
  findRecipient(reservation: NoShowReservation): Promise<NoShowFollowupRecipient | null>;
  /** Hand the message to the outbox, which owns delivery and retries. */
  queueFollowup(input: { tenantId: string; waAccountId: string; to: string; text: string }): Promise<void>;
  /** Stamp the no-show: no_show_detected=true at the given instant. */
  markDetected(reservationId: string, detectedAt: Date): Promise<void>;
  /** Record that this reservation's rebook offer has been sent. */
  markFollowupSent(reservationId: string, sentAt: Date): Promise<void>;
}

export interface NoShowCronOptions {
  /** Reference "now"; the cron injects it so tests can move time. */
  now?: Date;
  /** Phase 1: how long after the booked time passed before a no-show is detectable. */
  graceHours?: number;
  /** Phase 2: how long after detection before the offer goes out. */
  delayHours?: number;
  limit?: number;
}

export interface NoShowSummary {
  /** Phase 1 — no-shows detected and stamped this run. */
  detected: number;
  /** Phase 2 — follow-up-due rows scanned. */
  scanned: number;
  /** Phase 2 — rebook offers queued. */
  sent: number;
  skipped: {
    /** Phase 1 — row no longer satisfies the detection predicates on re-check. */
    stale: number;
    /** Phase 2 — detected less than 2 hours ago. */
    notYetDue: number;
    /** Phase 2 — no way to reach the customer (no phone, no connected account). */
    noRecipient: number;
    /** Phase 2 — thread in manual takeover; staff owns the conversation. */
    manualTakeover: number;
    /** A write failed: the detection stamp or the outbox insert. */
    failed: number;
  };
  samples: Array<{ reservationId: string; to: string; text: string }>;
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Start of the UTC day containing `now`. */
export function startOfTodayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The detection cutoff for "now": a confirmed booking is a no-show when
 * its date is strictly before this instant.
 *
 *   cutoff = max(start of today, now − 2h)
 *
 * max(start-of-today, …) is what catches the 23:30-booked → 00:30-checked
 * edge: a pure now − 2h cutoff would only flag that booking at 01:30, even
 * though its entire day has already passed.
 */
export function detectionCutoff(now: Date, options: { graceHours?: number } = {}): Date {
  const graceHours = positive(options.graceHours, DETECTION_GRACE_HOURS);
  const graceAgo = now.getTime() - graceHours * MS_PER_HOUR;
  const dayStart = startOfTodayUtc(now).getTime();
  return new Date(dayStart > graceAgo ? dayStart : graceAgo);
}

/**
 * A confirmed booking is a no-show once its date is strictly before the
 * detection cutoff. The strictness matches the SQL
 * (`date < cutoff`): exactly 2 hours is not yet a no-show.
 */
export function isNoShowDue(
  reservationDate: Date,
  now: Date,
  options: { graceHours?: number } = {}
): boolean {
  return reservationDate.getTime() < detectionCutoff(now, options).getTime();
}

/**
 * The gate's two-clause rule, kept verbatim for the equivalence proof:
 * the booking's day is fully past, or the booking is today and at least
 * the grace period ago.
 *
 * isNoShowDue (cutoff form) must agree with this at every instant —
 * no-show.test.ts sweeps 97 hours to pin that, including the 00:00–02:00
 * window where the cutoff flips from now − 2h to start-of-today.
 */
export function isNoShowDueReference(
  reservationDate: Date,
  now: Date,
  options: { graceHours?: number } = {}
): boolean {
  const graceHours = positive(options.graceHours, DETECTION_GRACE_HOURS);
  const at = reservationDate.getTime();
  const dayStart = startOfTodayUtc(now).getTime();
  const graceAgo = now.getTime() - graceHours * MS_PER_HOUR;
  return at < dayStart || (at >= dayStart && at < graceAgo);
}

export type NoShowFollowupEligibility = 'due' | 'not_yet_due';

/**
 * Is this detected no-show old enough to be offered a rebook?
 *
 * The store query already applies the same bound; re-checking here keeps a
 * too-wide query (or a hand-rolled caller) from messaging someone it
 * should not. The bound is strict, matching the SQL
 * (`no_show_detected_at < NOW() − 2h`): exactly 2 hours is not yet due.
 */
export function noShowFollowupEligibility(
  reservation: Pick<NoShowReservation, 'noShowDetectedAt'>,
  options: NoShowCronOptions = {}
): NoShowFollowupEligibility {
  const now = options.now ?? new Date();
  const delayHours = positive(options.delayHours, FOLLOWUP_DELAY_HOURS);
  const detectedAt = reservation.noShowDetectedAt;
  if (!detectedAt) return 'not_yet_due';
  return detectedAt.getTime() < now.getTime() - delayHours * MS_PER_HOUR ? 'due' : 'not_yet_due';
}

/**
 * The next weekend day (Saturday or Sunday) strictly after today's UTC
 * date.
 *
 * The no-show already happened tonight, so the earliest seat we can
 * honestly offer is tomorrow at the earliest: a Saturday-night no-show
 * offers Sunday, a Sunday-night one offers the coming Saturday. (The
 * offered day's name is what the message prints — "this Saturday" — the
 * same phrasing Gate #3 uses for its weekday offer.)
 */
export function nextWeekendDay(now: Date): Date {
  const dayStart = startOfTodayUtc(now).getTime();
  for (let i = 1; i <= 8; i += 1) {
    const candidate = new Date(dayStart + i * MS_PER_DAY);
    const dow = candidate.getUTCDay();
    if (dow === 6 || dow === 0) return candidate;
  }
  /* c8 ignore next -- an 8-day scan always contains a Saturday or Sunday */
  return new Date(dayStart);
}

/**
 * The rebook offer. The weekend comes from the time of SENDING, not the
 * booking: the customer missed last night, so the offer points at the
 * next weekend that is still ahead.
 */
export function buildNoShowMessage(input: {
  customerName?: string | null;
  now: Date;
}): string {
  const name = input.customerName?.trim() || 'there';
  const weekend = nextWeekendDay(input.now);
  return `Hi ${name}, we missed you tonight! We still have tables available this ${DAY_NAMES[weekend.getUTCDay()]}. Would you like to rebook?`;
}

/**
 * One cron run: detect due no-shows and stamp them (Phase 1), then offer
 * a rebook to the ones detected more than 2 hours ago (Phase 2).
 *
 * A row stamped in Phase 1 of THIS run can never be messaged in Phase 2
 * of THIS run — its stamp is `now`, which is not older than 2 hours — so
 * the two phases never double-handle a row.
 */
export async function runNoShowCron(
  store: NoShowStore,
  options: NoShowCronOptions = {}
): Promise<NoShowSummary> {
  const now = options.now ?? new Date();
  const limit = positive(options.limit, DEFAULT_LIMIT);

  const summary: NoShowSummary = {
    detected: 0,
    scanned: 0,
    sent: 0,
    skipped: { stale: 0, notYetDue: 0, noRecipient: 0, manualTakeover: 0, failed: 0 },
    samples: [],
  };

  // ── Phase 1 — DETECT ─────────────────────────────────────────────────
  const cutoff = detectionCutoff(now, options);
  const detectable = await store.findDetectable({ cutoff, limit });
  for (const reservation of detectable) {
    // Defense in depth: the query already applied these predicates, but a
    // row can change between the SELECT and this loop (or a hand-rolled
    // caller can hand the runner a too-wide result set). Re-check every
    // predicate from the row itself before stamping.
    if (
      reservation.status !== 'confirmed' ||
      reservation.noShowDetected ||
      !isNoShowDue(reservation.reservationDate, now, options)
    ) {
      summary.skipped.stale += 1;
      continue;
    }

    try {
      await store.markDetected(reservation.id, now);
    } catch (err) {
      // Not stamped, so the next run retries. One bad row must not abort
      // the batch.
      summary.skipped.failed += 1;
      console.error(`[No-Show Monitoring] Failed to stamp no-show for reservation ${reservation.id}`, err);
      continue;
    }

    summary.detected += 1;
  }

  // ── Phase 2 — FOLLOW-UP ──────────────────────────────────────────────
  const delayHours = positive(options.delayHours, FOLLOWUP_DELAY_HOURS);
  const detectedBefore = new Date(now.getTime() - delayHours * MS_PER_HOUR);
  const due = await store.findFollowupDue({ detectedBefore, limit });
  summary.scanned = due.length;

  for (const reservation of due) {
    // Bow out of manual-takeover threads: staff is running this
    // conversation and an automated offer would step on them. Left
    // unmarked, so the offer goes out once the thread is released.
    if (reservation.manualTakeover) {
      summary.skipped.manualTakeover += 1;
      continue;
    }

    const eligibility = noShowFollowupEligibility(reservation, { ...options, now });
    if (eligibility !== 'due') {
      summary.skipped.notYetDue += 1;
      continue;
    }

    const recipient = await store.findRecipient(reservation);
    if (!recipient?.to || !recipient.waAccountId) {
      // Left unmarked on purpose: a disconnected WhatsApp account should
      // not silently cost the customer their rebook offer.
      summary.skipped.noRecipient += 1;
      continue;
    }

    const text = buildNoShowMessage({
      customerName: recipient.name ?? reservation.customerName,
      now,
    });

    try {
      // The tenantId comes from the RESERVATION: per-reservation scoping
      // means every follow-up is routed through its own tenant's account,
      // never a neighbouring tenant's.
      await store.queueFollowup({
        tenantId: reservation.tenantId,
        waAccountId: recipient.waAccountId,
        to: recipient.to,
        text,
      });
    } catch (err) {
      // Not marked sent, so the next run tries again rather than losing
      // the offer — one bad row must not abort the batch either.
      summary.skipped.failed += 1;
      console.error(`[No-Show Monitoring] Failed to queue follow-up for reservation ${reservation.id}`, err);
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
