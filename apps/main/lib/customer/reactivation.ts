/**
 * Gate #9 — Reactivation Campaigns: message generator and rules.
 *
 * Framework-free like ./segmentation.ts and ./profile-builder.ts: no
 * Next.js, no Drizzle, no database. The cron boundary and the dashboard's
 * manual-send API both call buildReactivationMessage(); the unit tests
 * exercise it directly without any runtime.
 *
 * Two audiences, two messages:
 *
 *   dormant  (180+ days)  — "we've missed you", lead with what's new and a
 *                           10% weekend incentive to come back at all.
 *   at_risk  (120–180 d)  — the relationship is still warm, so no discount:
 *                           just a nudge to rebook this week.
 *
 * Personalisation is additive: preferences (dietary tags, favourite dishes)
 * and known occasions (birthday, anniversary) are appended as extra
 * sentences so the base copy always matches the gate's specified wording.
 */

import { daysSince, type CustomerProfileForSegmentation } from './segmentation.ts';

/** Only these two lifecycle segments are ever reactivation targets. */
export const REACTIVATION_SEGMENTS = ['dormant', 'at_risk'] as const;
export type ReactivationSegment = (typeof REACTIVATION_SEGMENTS)[number];

/** Dormant = last visit older than this (or segment already says dormant). */
export const DORMANT_THRESHOLD_DAYS = 180;
/** At-risk window, matching Gate #8's segmentation boundaries. */
export const AT_RISK_MIN_DAYS = 120;
export const AT_RISK_MAX_DAYS = 180;
/** A customer who received any campaign in the last 90 days is skipped. */
export const REACTIVATION_COOLDOWN_DAYS = 90;
/** How long after a send an inbound reply still counts as a response. */
export const REACTIVATION_REPLY_WINDOW_DAYS = 14;
/** Discount offered to dormant customers only (at-risk need no bribe). */
export const DORMANT_DISCOUNT_PERCENT = 10;

/** Inbound keywords that count as "responding with booking intent". */
export const REACTIVATION_REPLY_KEYWORDS = [
  'book',
  'booking',
  'reserve',
  'reservation',
  'rebook',
  'table',
] as const;

export interface ReactivationPreferences {
  dietary?: string[];
  occasions?: string[];
  favorites?: string[];
}

export interface ReactivationMessageInput {
  segment: ReactivationSegment;
  customerName?: string | null;
  restaurantName?: string | null;
  preferences?: ReactivationPreferences | null;
  /** Days since the last visit, when the caller already computed it. */
  daysSinceLastVisit?: number | null;
}

export interface ReactivationMessage {
  text: string;
  metadata: {
    segment: ReactivationSegment;
    customerName: string;
    restaurantName: string;
    mentionedDietary: string | null;
    mentionedFavorite: string | null;
    mentionedOccasion: string | null;
    daysSinceLastVisit: number | null;
  };
}

export interface ReactivationTarget {
  segment: ReactivationSegment;
  daysSinceLastVisit: number | null;
}

function firstTag(tags: string[] | null | undefined): string | null {
  const tag = (tags ?? []).map((t) => String(t).trim().toLowerCase()).find(Boolean);
  return tag ?? null;
}

/** Build the personalised win-back copy for one customer. */
export function buildReactivationMessage(input: ReactivationMessageInput): ReactivationMessage {
  const name = input.customerName?.trim() || 'there';
  const restaurant = input.restaurantName?.trim() || '';
  const dietary = firstTag(input.preferences?.dietary);
  const favorite = firstTag(input.preferences?.favorites);
  const occasion = firstTag(input.preferences?.occasions);

  const sentences: string[] = [];

  if (input.segment === 'dormant') {
    // Base copy per the gate spec. The restaurant clause degrades to a bare
    // "we've missed you!" when the tenant name is unknown rather than
    // producing "we've missed you at !".
    sentences.push(
      restaurant
        ? `Hi ${name}, we've missed you at ${restaurant}! We've added new dishes since your last visit. Come back this weekend and enjoy ${DORMANT_DISCOUNT_PERCENT}% off.`
        : `Hi ${name}, we've missed you! We've added new dishes since your last visit. Come back this weekend and enjoy ${DORMANT_DISCOUNT_PERCENT}% off.`
    );
  } else {
    sentences.push(
      `Hi ${name}, it's been a while! We'd love to see you again. Book a table this week and we'll save your favorite spot.`
    );
  }

  if (dietary) {
    sentences.push(`We've kept plenty of ${dietary} options on the menu for you.`);
  } else if (favorite) {
    // One personalisation sentence, not a laundry list: dietary needs come
    // first, and a favourite dish is only mentioned when diet is unknown.
    sentences.push(`Your favorite ${favorite} is still on the menu.`);
  }

  if (occasion === 'birthday') {
    sentences.push(`Your birthday is coming up — let us make it special!`);
  } else if (occasion) {
    sentences.push(`Your ${occasion} is coming up — let us make it special!`);
  }

  return {
    text: sentences.join(' '),
    metadata: {
      segment: input.segment,
      customerName: name,
      restaurantName: restaurant,
      mentionedDietary: dietary,
      mentionedFavorite: dietary ? null : favorite,
      mentionedOccasion: occasion,
      daysSinceLastVisit:
        typeof input.daysSinceLastVisit === 'number' && Number.isFinite(input.daysSinceLastVisit)
          ? input.daysSinceLastVisit
          : null,
    },
  };
}

/**
 * Which reactivation segment (if any) a customer belongs to, re-derived
 * from the profile instead of blindly trusting the stored segment.
 *
 * Priority order:
 *   1. last visit older than 180 days  -> dormant (the gate qualifies on
 *      `segment='dormant' OR last_visit > 180 days`, so a stale 'at_risk'
 *      label must not cost a customer the stronger dormant offer)
 *   2. last visit within 120 days      -> ineligible, whatever the label
 *      says (defense in depth: a stale segment must never message someone
 *      the visit history says is still active)
 *   3. stored segment dormant/at_risk  -> that segment
 *   4. last visit in the 120–180 window -> at_risk
 *
 * A NULL last_visit with a dormant label (never-visited profiles are
 * dormant by Gate #8's rules) still yields dormant without a day count.
 */
export function resolveReactivationTarget(
  profile: Pick<CustomerProfileForSegmentation, 'lastVisitAt' | 'last_visit_at' | 'lastVisit'> & {
    segment?: string | null;
  },
  now: Date = new Date()
): ReactivationTarget | null {
  const row = profile as Record<string, unknown>;
  const lastVisitAt = (row['lastVisitAt'] ?? row['last_visit_at'] ?? row['lastVisit'] ?? null) as
    | Date
    | string
    | number
    | null;
  const days = daysSince(lastVisitAt, now);

  if (days !== null && days > DORMANT_THRESHOLD_DAYS) {
    return { segment: 'dormant', daysSinceLastVisit: days };
  }
  if (days !== null && days <= AT_RISK_MIN_DAYS) {
    return null;
  }
  if (profile.segment === 'dormant') {
    return { segment: 'dormant', daysSinceLastVisit: days };
  }
  if (profile.segment === 'at_risk') {
    return { segment: 'at_risk', daysSinceLastVisit: days };
  }
  if (days !== null && days > AT_RISK_MIN_DAYS && days < AT_RISK_MAX_DAYS) {
    return { segment: 'at_risk', daysSinceLastVisit: days };
  }
  return null;
}

/**
 * Does an inbound message read like a response to a reactivation campaign?
 *
 * Whole-word match only ("book", "reserve", "table", …) — "I bookmarked you
 * ages ago" contains "book" as a substring but must not count. POPIA opt-out
 * commands ("STOP") never match, so an unsubscribe is never mistaken for a
 * campaign response.
 */
export function isReactivationReply(text: string): boolean {
  const normalized = (text ?? '').toLowerCase().trim();
  if (!normalized) return false;
  return REACTIVATION_REPLY_KEYWORDS.some((keyword) =>
    new RegExp(`\\b${keyword}\\b`).test(normalized)
  );
}

/**
 * The dashboard's response-rate line, e.g. "24 sent, 8 responded (33%)".
 * Zero sends render as "0 sent, 0 responded (0%)" rather than NaN%.
 */
export function formatResponseRate(sent: number, responded: number): string {
  const safeSent = Math.max(0, Math.floor(Number(sent) || 0));
  const safeResponded = Math.max(0, Math.floor(Number(responded) || 0));
  const clampedResponded = Math.min(safeResponded, safeSent);
  const rate = safeSent === 0 ? 0 : Math.round((clampedResponded / safeSent) * 100);
  return `${safeSent} sent, ${clampedResponded} responded (${rate}%)`;
}

export function isReactivationSegment(value: string | null | undefined): value is ReactivationSegment {
  return !!value && (REACTIVATION_SEGMENTS as readonly string[]).includes(value);
}
