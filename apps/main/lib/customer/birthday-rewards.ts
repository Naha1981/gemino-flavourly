/**
 * Birthday rewards (Rewards/Loyalty system).
 *
 * A customer whose birthday falls within the next 7 days gets an
 * auto-generated reward offer. This module is pure (no Drizzle/Next imports)
 * so the "is this birthday inside the window?" and "what does the offer look
 * like?" logic is unit-testable; the Postgres adapter + cron live in
 * ./birthday-store.ts / app/api/cron/birthday-rewards/route.ts.
 */

export const BIRTHDAY_WINDOW_DAYS = 7;

/** A contact with the fields birthday detection needs. */
export interface BirthdayContactLike {
  id?: string;
  customerPhone: string;
  customerName: string | null;
  /** MM-DD, e.g. "08-27". */
  birthday: string | null;
  blocklisted?: boolean;
  /** Last time a birthday reward was already sent to avoid duplicates. */
  lastBirthdayRewardSentAt?: Date | string | null;
}

export interface BirthdayReward {
  contactId: string;
  customerPhone: string;
  customerName: string;
  daysUntilBirthday: number;
  offer: string;
  message: string;
}

/**
 * Days from `now` until the contact's next birthday in the current year,
 * handling the year-boundary wrap (Dec birthday after our year start). Returns
 * null when the birthday is missing/malformed or outside the window.
 */
export function daysUntilNextBirthday(birthday: string, now: Date): number | null {
  if (!birthday || !/^\d{2}-\d{2}$/.test(birthday)) return null;
  const [mm, dd] = birthday.split('-').map(Number);
  if (!mm || !dd || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const thisYear = now.getFullYear();

  let target = new Date(thisYear, mm - 1, dd);
  // If this year's date already passed, the "next" birthday is next year.
  if (target.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    target = new Date(thisYear + 1, mm - 1, dd);
  }

  const days = Math.ceil((target.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / MS_PER_DAY);
  return days >= 0 && days <= BIRTHDAY_WINDOW_DAYS ? days : null;
}

/** A contact is a birthday candidate when its birthday falls in the window. */
export function isBirthdayInWindow(contact: BirthdayContactLike, now: Date): boolean {
  if (!contact.birthday || contact.blocklisted) return false;
  return daysUntilNextBirthday(contact.birthday, now) !== null;
}

/** Build the reward offer + WhatsApp message for a birthday contact. */
export function buildBirthdayReward(contact: BirthdayContactLike, now: Date): BirthdayReward | null {
  if (!contact.birthday || contact.blocklisted) return null;
  const days = daysUntilNextBirthday(contact.birthday, now);
  if (days === null) return null;

  const name = contact.customerName?.trim() || 'friend';
  const offer = days === 0 ? 'A complimentary dessert on us today!' : 'A complimentary dessert on your birthday!';
  const message =
    `🎂 Happy almost-birthday, ${name}! ` +
    `It's in ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`} 🎉. ` +
    `Book a table and we'll bring out a complimentary dessert on the house — just show this message. ` +
    `Reply BOOK to reserve.`;

  return {
    contactId: contact.id ?? '',
    customerPhone: contact.customerPhone,
    customerName: name,
    daysUntilBirthday: days,
    offer,
    message,
  };
}

/** Dedup a list of candidates: one reward per contact, skipping already-opted-out. */
export function selectBirthdayRewards(
  contacts: BirthdayContactLike[],
  now: Date
): BirthdayReward[] {
  const out: BirthdayReward[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    if (!c.customerPhone || seen.has(c.customerPhone)) continue;
    const reward = buildBirthdayReward(c, now);
    if (!reward) continue;
    seen.add(c.customerPhone);
    out.push(reward);
  }
  return out;
}
