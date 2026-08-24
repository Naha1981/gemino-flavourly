/**
 * Gate #9 — Reactivation Campaigns.
 *
 * Who is eligible for a win-back message, and what that message says.
 *
 * This module contains only decision logic and copy assembly. It deliberately
 * has no Next.js, Drizzle, or database imports (it reuses only the equally
 * framework-free ./segmentation.ts helpers) so the rules can be exercised by
 * unit tests and reused by the cron boundary without coupling the decision to
 * a particular runtime. The Postgres adapter lives in ./reactivation-store.ts.
 */

import { daysSince } from './segmentation.ts';

// -----------------------------------------------------------------------------
// Windows (kept aligned with ./segmentation.ts so the segmentation cron and
// the reactivation cron agree about who is a win-back customer)
// -----------------------------------------------------------------------------

/** At-risk: last visit strictly more than this many days ago. */
export const AT_RISK_MIN_DAYS = 120;
/** Dormant: last visit this many days ago or more ("180+ days"). */
export const DORMANT_MIN_DAYS = 180;
/**
 * A customer who received a campaign within this window is skipped by the
 * cron — the anti-spam rule. One win-back message per customer per quarter.
 */
export const REACTIVATION_COOLDOWN_DAYS = 90;
/**
 * How long after a campaign is sent that an inbound customer reply still
 * counts as a response to it. After this, a reply is just a normal message.
 */
export const REACTIVATION_RESPONSE_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The only two segments a reactivation campaign targets. */
export type ReactivationSegment = 'dormant' | 'at_risk';

export const REACTIVATION_SEGMENTS = ['dormant', 'at_risk'] as const;

export function isReactivationSegment(value: string | null | undefined): value is ReactivationSegment {
  return !!value && (REACTIVATION_SEGMENTS as readonly string[]).includes(value);
}

// -----------------------------------------------------------------------------
// Eligibility
// -----------------------------------------------------------------------------

type DateLike = Date | string | number | null | undefined;
type NumberLike = number | string | null | undefined;

/**
 * The profile shape the eligibility decision needs. The camelCase names are
 * the Drizzle shape; snake-case aliases are accepted as well because raw
 * Postgres rows are just as valid an input.
 */
export interface CustomerProfileForReactivation {
  customerName?: string | null;
  customer_name?: string | null;
  customerPhone?: string | null;
  customer_phone?: string | null;
  totalVisits?: NumberLike;
  total_visits?: NumberLike;
  lastVisitAt?: DateLike;
  last_visit_at?: DateLike;
  /** The lifecycle segment stored on the profile by the Gate #8 cron. */
  segment?: string | null;
  storedSegment?: string | null;
  stored_segment?: string | null;
  /** jsonb `preferences`: { dietary: string[], occasions: string[] }. */
  preferences?: unknown;
}

export interface ReactivationTarget {
  segment: ReactivationSegment;
  /** Fractional days since the last visit; null when no visit is recorded. */
  daysSinceVisit: number | null;
}

function valueOf(profile: CustomerProfileForReactivation, ...keys: string[]): unknown {
  const row = profile as Record<string, unknown>;
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
}

/**
 * Decide whether a profile should get a reactivation campaign right now,
 * and which variant (dormant or at-risk) fits.
 *
 * ── A fresh visit date always beats a stored label ──────────────────────
 *
 * The stored `segment` was computed by a cron that may have last run hours
 * (or, if the cron is broken, weeks) ago. If the profile carries a
 * `last_visit_at`, THAT is the truth: a customer stamped 'dormant' who has
 * since walked in 10 days ago must not be told "we've missed you". So the
 * visit date decides first, and the stored label is only consulted when no
 * visit is recorded at all.
 *
 * Windows (aligned with ./segmentation.ts):
 *   last visit 0-120 days ago   -> not eligible (fresh enough)
 *   last visit >120 and <180    -> at_risk
 *   last visit >=180 days ago   -> dormant
 *   no last visit recorded      -> the stored label, if it is a win-back
 *                                  segment ('dormant' matches Gate #8's
 *                                  rule that an unknown visit is dormant)
 */
export function resolveReactivationTarget(
  profile: CustomerProfileForReactivation,
  options: { now?: Date } = {}
): ReactivationTarget | null {
  const now = options.now ?? new Date();
  const lastVisitAt = valueOf(profile, 'lastVisitAt', 'last_visit_at') as DateLike;
  const days = daysSince(lastVisitAt, now);

  if (days !== null) {
    // Fresh visit date wins over any stored label, including a stale
    // 'dormant'/'at_risk' one.
    if (days <= AT_RISK_MIN_DAYS) return null;
    if (days < DORMANT_MIN_DAYS) return { segment: 'at_risk', daysSinceVisit: days };
    return { segment: 'dormant', daysSinceVisit: days };
  }

  const stored = valueOf(profile, 'segment', 'storedSegment', 'stored_segment') as string | null | undefined;
  if (isReactivationSegment(stored)) {
    return { segment: stored, daysSinceVisit: null };
  }
  return null;
}

// -----------------------------------------------------------------------------
// Message generation
// -----------------------------------------------------------------------------

export interface ReactivationPreferences {
  dietary: string[];
  occasions: string[];
}

/**
 * Normalize the profile's jsonb `preferences` into the two lists the copy
 * uses. Accepts the camelCase builder shape ({ dietary, occasions }) plus a
 * few reasonable spellings, and ignores everything else (favorites do not
 * change win-back copy).
 */
export function extractReactivationPreferences(preferences: unknown): ReactivationPreferences {
  const source = (preferences ?? {}) as Record<string, unknown>;
  const dietary = asTagList(source.dietary).slice(0, 2);
  const occasions = asTagList(source.occasions).slice(0, 1);
  return { dietary, occasions };
}

function asTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

export interface GenerateReactivationMessageInput {
  segment: ReactivationSegment;
  customerName?: string | null;
  /** Tenant/restaurant name; only the dormant variant names the restaurant. */
  restaurantName?: string | null;
  preferences?: unknown;
}

export interface GeneratedReactivationMessage {
  segment: ReactivationSegment;
  messageText: string;
  metadata: {
    /** The name actually used in the greeting (fallback: 'there'). */
    greetedName: string;
    restaurantName: string | null;
    /** Dietary preferences woven into the copy, e.g. ['vegetarian']. */
    mentionedPreferences: string[];
    /** The occasion mentioned, e.g. 'birthday', or null. */
    mentionedOccasion: string | null;
    /** The incentive line, e.g. '10% off', or null for at-risk copy. */
    offer: string | null;
  };
}

/**
 * Assemble the win-back message for one customer.
 *
 * Dormant (180+ days) — name the restaurant, say the menu moved on, offer a
 * reason to return this weekend:
 *   "Hi Thabo, we've missed you at Flavourly! We've added new dishes since
 *    your last visit. Come back this weekend and enjoy 10% off."
 *
 * At-risk (120-180 days) — softer nudge, no discount needed yet:
 *   "Hi Thabo, it's been a while! We'd love to see you again. Book a table
 *    this week and we'll save your favorite spot."
 *
 * Personalization lines are appended for known dietary preferences and an
 * upcoming occasion, so the message reads like it was written by someone who
 * remembers the customer — which is the whole point of the feature.
 */
export function generateReactivationMessage(input: GenerateReactivationMessageInput): GeneratedReactivationMessage {
  const name = input.customerName?.trim() || 'there';
  const restaurant = input.restaurantName?.trim() || null;
  const { dietary, occasions } = extractReactivationPreferences(input.preferences);

  let base: string;
  let offer: string | null;
  if (input.segment === 'dormant') {
    base = restaurant
      ? `Hi ${name}, we've missed you at ${restaurant}! We've added new dishes since your last visit. Come back this weekend and enjoy 10% off.`
      : `Hi ${name}, we've missed you! We've added new dishes since your last visit. Come back this weekend and enjoy 10% off.`;
    offer = '10% off';
  } else {
    base = `Hi ${name}, it's been a while! We'd love to see you again. Book a table this week and we'll save your favorite spot.`;
    offer = null;
  }

  let text = base;
  if (dietary.length > 0) {
    const list = dietary.join(' and ');
    text += ` And yes — your favorite ${list} dishes are still on the menu.`;
  }

  let mentionedOccasion: string | null = null;
  if (occasions.length > 0) {
    mentionedOccasion = occasions[0];
    text += ` Your ${mentionedOccasion} is coming up — let us make it special!`;
  }

  return {
    segment: input.segment,
    messageText: text,
    metadata: {
      greetedName: name,
      restaurantName: restaurant,
      mentionedPreferences: dietary,
      mentionedOccasion,
      offer,
    },
  };
}

// -----------------------------------------------------------------------------
// Cooldown + response windows
// -----------------------------------------------------------------------------

/**
 * True when `lastDate` (a previous campaign's sent_at, or a pending
 * campaign's created_at) is recent enough that the cooldown must block a new
 * campaign. Strictly less than the cooldown: exactly 90 days is eligible
 * again.
 */
export function isWithinCampaignCooldown(
  lastDate: Date,
  now: Date = new Date(),
  cooldownDays: number = REACTIVATION_COOLDOWN_DAYS
): boolean {
  const elapsed = now.getTime() - lastDate.getTime();
  return elapsed >= 0 && elapsed < cooldownDays * MS_PER_DAY;
}

/**
 * True when `sentAt` is recent enough that a customer reply should be
 * attributed to that campaign.
 */
export function isWithinResponseWindow(
  sentAt: Date,
  now: Date = new Date(),
  windowDays: number = REACTIVATION_RESPONSE_WINDOW_DAYS
): boolean {
  const elapsed = now.getTime() - sentAt.getTime();
  return elapsed >= 0 && elapsed < windowDays * MS_PER_DAY;
}

/**
 * Does an inbound reply look like the customer acting on the campaign (a
 * booking intent)? Used to attribute responses and to hint the booking flow;
 * any reply within the window still counts as a response — the campaign did
 * its job of restarting the conversation either way.
 */
export function isReactivationBookingReply(text: string): boolean {
  return /\b(book|booking|reserve|reservation|table)\b/i.test(text ?? '');
}
