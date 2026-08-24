/**
 * Gate #10 — VIP Recognition.
 *
 * This module contains only the decision logic and the copy for staff-facing
 * VIP alerts. It deliberately has no Next.js, Drizzle, or database imports so
 * the rules can be exercised by unit tests and reused by the webhook boundary
 * without coupling the decision to a particular runtime. The Postgres adapter
 * lives in ./vip-store.ts.
 */

// -----------------------------------------------------------------------------
// Profile + alert shapes
// -----------------------------------------------------------------------------

type DateLike = Date | string | number | null | undefined;
type NumberLike = number | string | null | undefined;

/**
 * The profile shape VIP detection needs. The camelCase names are the Drizzle
 * shape; snake-case aliases are accepted as well because raw Postgres rows
 * are just as valid an input.
 */
export interface VipProfileLike {
  customerName?: string | null;
  customer_name?: string | null;
  customerPhone?: string | null;
  customer_phone?: string | null;
  totalVisits?: NumberLike;
  total_visits?: NumberLike;
  totalSpendCents?: NumberLike;
  total_spend_cents?: NumberLike;
  lastVisitAt?: DateLike;
  last_visit_at?: DateLike;
  /** jsonb `preferences`: { dietary: string[], occasions: string[], favorites: string[] }. */
  preferences?: unknown;
  /** The lifecycle segment stored on the profile by the Gate #8 cron. */
  segment?: string | null;
}

/** The normalized alert payload produced when a VIP customer is recognized. */
export interface VipAlertData {
  customerPhone: string;
  customerName: string | null;
  totalVisits: number;
  totalSpendCents: number;
  lastVisitAt: Date | null;
  preferences: unknown;
}

/** A VIP alert plus the staff-facing copy generated from it. */
export interface VipProcessed {
  alert: VipAlertData;
  /** The long alert message surfaced to staff on the inbox banner. */
  message: string;
  /** The short system message injected into the conversation thread. */
  systemMessage: string;
}

/** The persist/query boundary the webhook uses; implemented by vip-store.ts. */
export interface VipRecognitionStore {
  /** Look up a customer profile for a phone + tenant, tenant-scoped. */
  findProfileByPhone(tenantId: string, customerPhone: string): Promise<VipProfileLike | null>;
  /** Insert a VIP alert row. */
  saveVipAlert(input: { tenantId: string; alert: VipAlertData }): Promise<{ id: string } | null>;
  /** Insert a staff-facing system message into the conversation thread. */
  saveSystemMessage(input: {
    tenantId: string;
    conversationId: string;
    content: string;
  }): Promise<{ id: string } | null>;
}

// -----------------------------------------------------------------------------
// Value helpers
// -----------------------------------------------------------------------------

function valueOf(profile: VipProfileLike, ...keys: string[]): unknown {
  const row = profile as Record<string, unknown>;
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
}

function asNonNegativeNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a cents amount as whole rand ('R3000'), keeping .00 dropped. */
export function formatRandCents(cents: number): string {
  const rand = (cents ?? 0) / 100;
  return Number.isInteger(rand) ? String(rand) : rand.toFixed(2);
}

/** Format a timestamp as YYYY-MM-DD; unknown / invalid -> 'unknown'. */
export function formatVisitDate(value: DateLike): string {
  const date = asDate(value);
  if (!date) return 'unknown';
  return date.toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// Preferences -> copy
// -----------------------------------------------------------------------------

export interface VipPreferences {
  dietary: string[];
  favorite: string | null;
}

/**
 * Normalize the profile's jsonb `preferences` into the dietary list and the
 * favorite dish the VIP copy uses. Accepts the camelCase builder shape
 * ({ dietary, favorites, occasions }) plus a few reasonable spellings and
 * ignores everything else.
 */
export function extractVipPreferences(preferences: unknown): VipPreferences {
  const source = (preferences ?? {}) as Record<string, unknown>;
  const dietary = asTagList(source.dietary).slice(0, 3);
  const favorites = asTagList(source.favorites).slice(0, 1);
  return { dietary, favorite: favorites[0] ?? null };
}

function asTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

// -----------------------------------------------------------------------------
// Detection
// -----------------------------------------------------------------------------

/**
 * Decide whether a profile belongs to a VIP who just walked in. Returns the
 * alert payload (with copy) when the profile exists AND its lifecycle segment
 * is 'vip'; returns null for non-VIP profiles or a missing profile so the
 * webhook can simply fall through to the customer's conversation.
 */
export function detectVipAlert(profile: VipProfileLike): VipProcessed | null {
  const segment = valueOf(profile, 'segment');
  if (segment !== 'vip') return null;

  const customerPhone = String(valueOf(profile, 'customerPhone', 'customer_phone') ?? '');
  const customerName = (valueOf(profile, 'customerName', 'customer_name') as string | null | undefined) ?? null;
  const totalVisits = asNonNegativeNumber(valueOf(profile, 'totalVisits', 'total_visits'));
  const totalSpendCents = asNonNegativeNumber(valueOf(profile, 'totalSpendCents', 'total_spend_cents'));
  const lastVisitAt = asDate(valueOf(profile, 'lastVisitAt', 'last_visit_at'));
  const preferences = valueOf(profile, 'preferences') ?? {};

  if (!customerPhone) return null;

  const alert: VipAlertData = {
    customerPhone,
    customerName,
    totalVisits,
    totalSpendCents,
    lastVisitAt,
    preferences,
  };

  return {
    alert,
    message: generateVipAlertMessage(alert),
    systemMessage: generateVipSystemMessage(alert),
  };
}

/** Display name fallback: the name when present, else 'Guest'. */
export function vipDisplayName(alert: VipAlertData): string {
  return alert.customerName?.trim() || 'Guest';
}

// -----------------------------------------------------------------------------
// Copy generation
// -----------------------------------------------------------------------------

/**
 * Assemble the staff-facing VIP alert message:
 *   "🌟 VIP Alert: Thabo just walked in! 12 visits, R3000 total spend.
 *    Preferences: vegetarian, vegan. Favorite dish: butter chicken.
 *    Last visited: 2026-08-01."
 */
export function generateVipAlertMessage(alert: VipAlertData): string {
  const name = vipDisplayName(alert);
  const { dietary, favorite } = extractVipPreferences(alert.preferences);
  const dietaryText = dietary.length > 0 ? dietary.join(', ') : 'none';
  const favoriteText = favorite ?? 'none';
  return (
    `🌟 VIP Alert: ${name} just walked in! ${alert.totalVisits} visits, ` +
    `R${formatRandCents(alert.totalSpendCents)} total spend. ` +
    `Preferences: ${dietaryText}. Favorite dish: ${favoriteText}. ` +
    `Last visited: ${formatVisitDate(alert.lastVisitAt)}.`
  );
}

/** The short staff-only system message injected into the conversation thread. */
export function generateVipSystemMessage(alert: VipAlertData): string {
  const name = vipDisplayName(alert);
  return `🌟 VIP Alert sent: ${name} (${alert.totalVisits} visits, R${formatRandCents(alert.totalSpendCents)} spend)`;
}

// -----------------------------------------------------------------------------
// Webhook orchestration (framework-free)
// -----------------------------------------------------------------------------

/**
 * Run VIP recognition for the FIRST message of a new conversation:
 *   1. Look up the customer profile for this phone + tenant.
 *   2. If the profile exists and its segment is 'vip', build the alert.
 *   3. Persist the alert row and the staff-facing system message.
 * Returns null when there is nothing to alert, or throws nothing — callers
 * wrap this so a VIP bookkeeping failure can never break the conversation.
 */
export async function processFirstMessageVip(
  store: VipRecognitionStore,
  input: { tenantId: string; customerPhone: string; conversationId: string }
): Promise<VipProcessed | null> {
  const profile = await store.findProfileByPhone(input.tenantId, input.customerPhone);
  if (!profile) return null;

  const processed = detectVipAlert(profile);
  if (!processed) return null;

  await store.saveVipAlert({ tenantId: input.tenantId, alert: processed.alert });
  await store.saveSystemMessage({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    content: processed.systemMessage,
  });

  return processed;
}
