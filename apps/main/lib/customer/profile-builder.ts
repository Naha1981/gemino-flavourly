/**
 * Gate #7 — Customer 360 profile builder.
 *
 * Framework-free aggregation of visit history and conversation
 * preferences. The store layer loads rows; this module never imports
 * drizzle or Next.
 */

export const PROFILE_LOOKBACK_DAYS = 365;
export const AVG_CHECK_CENTS = 4900;

export const DIETARY_KEYWORDS = ['vegetarian', 'vegan', 'gluten-free', 'halal', 'kosher'] as const;
export const OCCASION_KEYWORDS = ['birthday', 'anniversary', 'date night', 'business dinner'] as const;

export type DietaryTag = (typeof DIETARY_KEYWORDS)[number];
export type OccasionTag = (typeof OCCASION_KEYWORDS)[number];

export interface ReservationLike {
  date: Date | string;
  partySize: number;
  status?: string | null;
}

export interface MessageLike {
  content: string;
  direction?: string | null;
}

export interface CustomerPreferences {
  dietary: DietaryTag[];
  occasions: OccasionTag[];
  favorites: string[];
}

export interface ProfileAggregates {
  totalVisits: number;
  totalSpendCents: number;
  avgPartySize: number;
  lastVisitAt: Date | null;
  firstVisitAt: Date | null;
  preferences: CustomerPreferences;
}

export function startOfToday(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function lookbackStart(now: Date = new Date(), days = PROFILE_LOOKBACK_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function isCompletedVisit(row: ReservationLike, today: Date): boolean {
  const at = new Date(row.date);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() < today.getTime();
}

export function inLookback(row: ReservationLike, start: Date, now: Date): boolean {
  const at = new Date(row.date);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() >= start.getTime() && at.getTime() <= now.getTime();
}

export function extractPreferences(messages: MessageLike[]): CustomerPreferences {
  const dietary = new Set<DietaryTag>();
  const occasions = new Set<OccasionTag>();
  const favorites = new Set<string>();

  for (const message of messages) {
    const text = (message.content ?? '').toLowerCase();
    if (!text) continue;

    for (const tag of DIETARY_KEYWORDS) {
      if (text.includes(tag)) dietary.add(tag);
    }
    for (const tag of OCCASION_KEYWORDS) {
      if (text.includes(tag)) occasions.add(tag);
    }

    const love = message.content.match(/i love the\s+([^.!?\n]+)/i);
    if (love?.[1]) {
      const dish = love[1].trim().replace(/\s+/g, ' ');
      if (dish) favorites.add(dish);
    }
  }

  return {
    dietary: Array.from(dietary),
    occasions: Array.from(occasions),
    favorites: Array.from(favorites),
  };
}

export function aggregateReservations(
  reservations: ReservationLike[],
  options: { now?: Date; lookbackDays?: number } = {}
): Omit<ProfileAggregates, 'preferences'> {
  const now = options.now ?? new Date();
  const today = startOfToday(now);
  const start = lookbackStart(now, options.lookbackDays ?? PROFILE_LOOKBACK_DAYS);

  const windowed = reservations.filter((row) => inLookback(row, start, now));
  const completed = windowed.filter((row) => isCompletedVisit(row, today));

  const totalVisits = completed.length;
  const totalSpendCents = completed.reduce((sum, row) => {
    const party = Number.isFinite(row.partySize) && row.partySize > 0 ? row.partySize : 1;
    return sum + party * AVG_CHECK_CENTS;
  }, 0);

  const partySizes = windowed
    .map((row) => row.partySize)
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgPartySize =
    partySizes.length === 0
      ? 0
      : Math.round((partySizes.reduce((a, b) => a + b, 0) / partySizes.length) * 100) / 100;

  let lastVisitAt: Date | null = null;
  let firstVisitAt: Date | null = null;
  for (const row of completed) {
    const at = new Date(row.date);
    if (!lastVisitAt || at.getTime() > lastVisitAt.getTime()) lastVisitAt = at;
    if (!firstVisitAt || at.getTime() < firstVisitAt.getTime()) firstVisitAt = at;
  }

  return { totalVisits, totalSpendCents, avgPartySize, lastVisitAt, firstVisitAt };
}

export function buildProfileSnapshot(
  reservations: ReservationLike[],
  messages: MessageLike[] = [],
  options: { now?: Date; lookbackDays?: number } = {}
): ProfileAggregates {
  return {
    ...aggregateReservations(reservations, options),
    preferences: extractPreferences(messages),
  };
}
