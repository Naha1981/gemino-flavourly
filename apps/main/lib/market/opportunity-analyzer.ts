/**
 * Gate #17 — market opportunity detection, framework-free.
 *
 * Reads what the tenant's competitors actually publish (Google place types
 * captured at discovery, scraped menus, price bands) and reports the gaps:
 * meals nobody serves, cuisines nobody covers, price bands nobody occupies,
 * day/time slots nobody trades in.
 *
 * Two things this module is deliberately NOT:
 *
 *   - Not probabilistic. Every score is a documented arithmetic formula over
 *     counted evidence, so the same input always yields the same output and a
 *     test can pin it.
 *   - Not generous. A gap is only reported when the evidence supports it, and
 *     the confidence says how strongly. Inventing "opportunities" from three
 *     scraped menus would teach the owner to ignore the list.
 *
 * Evidence sources, in order of reliability: Google's own `serves*` flags and
 * place types (captured at discovery), then the scraped menu text, then the
 * competitor's name ("Luigi's Italian" is weak but real evidence).
 */

import { parsePriceRange, type MenuItem } from './menu-scraper.ts';

export type OpportunityType = 'meal_gap' | 'cuisine_gap' | 'price_gap' | 'time_gap';

export interface Opportunity {
  /** Stable per-tenant identity, e.g. 'meal_gap:brunch'. Re-runs update, not duplicate. */
  key: string;
  opportunityType: OpportunityType;
  title: string;
  description: string;
  /** 0..1. See scoreGap for the formula. */
  confidence: number;
  evidence: string[];
}

export interface CompetitorOffering {
  id: string;
  name: string;
  distanceKm: number | null;
  menuItems: MenuItem[];
  /** Newest snapshot's text; null when nothing has been scraped yet. */
  menuText: string | null;
  /** Parsed {min,max} of the stored price band, when there is one. */
  priceRange: { min: number | null; max: number | null } | null;
  /** Google place types captured at discovery, e.g. ['italian_restaurant']. */
  placeTypes: string[];
  /** Google serves* flags captured at discovery, e.g. ['brunch']. */
  serves: string[];
  priceLevel: number | null;
  rating: number | null;
}

export interface TenantOffering {
  name: string;
  menuItems: MenuItem[];
  menuText: string | null;
  placeTypes: string[];
  serves: string[];
  /** The owner's own trading hours text, used for the time-slot gaps. */
  openingHours: string | null;
  priceLevel: number | null;
}

export interface OpportunityInput {
  tenant: TenantOffering;
  competitors: CompetitorOffering[];
  /** Displayed in the copy; defaults to the discovery radius. */
  radiusKm?: number;
}

// -----------------------------------------------------------------------------
// Vocabulary
// -----------------------------------------------------------------------------

interface MealSlot {
  key: string;
  label: string;
  /** Google serves* flag, when one exists. */
  servesFlag?: string;
  /** Menu/name keywords. */
  keywords: string[];
}

export const MEAL_SLOTS: MealSlot[] = [
  { key: 'breakfast', label: 'breakfast', servesFlag: 'breakfast', keywords: ['breakfast', 'brekfast', 'ontbyt', 'eggs benedict', 'full english'] },
  { key: 'brunch', label: 'brunch', servesFlag: 'brunch', keywords: ['brunch', 'bottomless brunch', 'shakshuka'] },
  { key: 'lunch', label: 'lunch', servesFlag: 'lunch', keywords: ['lunch', 'lunch special', 'middagete'] },
];

interface TimeSlot {
  key: string;
  label: string;
  keywords: string[];
}

export const TIME_SLOTS: TimeSlot[] = [
  { key: 'late_night', label: 'late-night trade (after 22:00)', keywords: ['late night', 'late-night', 'open late', 'midnight', 'after hours', 'till late'] },
  { key: 'sunday_service', label: 'Sunday trading', keywords: ['sunday', 'sondag', 'sundays'] },
  { key: 'sunday_brunch', label: 'Sunday brunch', keywords: ['sunday brunch', 'sondag brunch'] },
];

/**
 * Cuisines/dietary categories worth checking for. The `types` suffixes match
 * Google's own place types ('italian_restaurant', 'vegan_restaurant'), so
 * discovery data is used when it exists.
 */
export const CUISINES: Array<{ key: string; label: string; typeSuffix?: string; keywords: string[] }> = [
  { key: 'vegan', label: 'vegan', typeSuffix: 'vegan_restaurant', keywords: ['vegan'] },
  { key: 'vegetarian', label: 'vegetarian', typeSuffix: 'vegetarian', keywords: ['vegetarian', 'veggie'] },
  { key: 'gluten_free', label: 'gluten-free', keywords: ['gluten free', 'gluten-free', 'glutenfree', 'coeliac', 'celiac'] },
  { key: 'halal', label: 'halal', keywords: ['halal'] },
  { key: 'italian', label: 'Italian', typeSuffix: 'italian_restaurant', keywords: ['italian', 'pasta', 'risotto', 'gnocchi'] },
  { key: 'indian', label: 'Indian', typeSuffix: 'indian_restaurant', keywords: ['indian', 'curry', 'tandoori', 'biryani'] },
  { key: 'thai', label: 'Thai', typeSuffix: 'thai_restaurant', keywords: ['thai', 'pad thai', 'green curry'] },
  { key: 'japanese', label: 'Japanese', typeSuffix: 'japanese_restaurant', keywords: ['japanese', 'sushi', 'ramen'] },
  { key: 'mexican', label: 'Mexican', typeSuffix: 'mexican_restaurant', keywords: ['mexican', 'tacos', 'burrito', 'enchilada'] },
  { key: 'portuguese', label: 'Portuguese', typeSuffix: 'portuguese_restaurant', keywords: ['portuguese', 'peri peri', 'periperi', 'piri piri'] },
  { key: 'ethiopian', label: 'Ethiopian', typeSuffix: 'ethiopian_restaurant', keywords: ['ethiopian', 'injera'] },
  { key: 'lebanese', label: 'Lebanese', typeSuffix: 'lebanese_restaurant', keywords: ['lebanese', 'mezze', 'meze'] },
  { key: 'seafood', label: 'seafood', typeSuffix: 'seafood_restaurant', keywords: ['seafood', 'prawns', 'mussels', 'linefish'] },
  { key: 'steakhouse', label: 'steakhouse', typeSuffix: 'steak_house', keywords: ['steakhouse', 'steak house', 'ribeye', 'sirloin'] },
  { key: 'pizza', label: 'pizza', typeSuffix: 'pizza_restaurant', keywords: ['pizza', 'pizzeria'] },
  { key: 'tapas', label: 'tapas / small plates', keywords: ['tapas', 'small plates', 'pintxos'] },
];

/** Average item price bands, in the tenant's currency. */
export const PRICE_BANDS = [
  { key: 'budget', label: 'budget', max: 100 },
  { key: 'premium', label: 'premium', min: 250 },
] as const;

/** At least this many competitors must be analysed before a gap scores highly. */
const MIN_CONFIDENT_SAMPLE = 5;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function haystack(offering: { name: string; menuText: string | null; menuItems: MenuItem[] }): string {
  const itemNames = offering.menuItems.map((item) => item.name).join(' ');
  return `${offering.name} ${offering.menuText ?? ''} ${itemNames}`.toLowerCase();
}

function matchesAny(text: string, keywords: string[]): string | null {
  for (const keyword of keywords) {
    if (text.includes(keyword)) return keyword;
  }
  return null;
}

/** A competitor serves this meal slot? Returns the evidence, or null. */
export function servesMeal(offering: CompetitorOffering, slot: MealSlot): string | null {
  if (slot.servesFlag && offering.serves.includes(slot.servesFlag)) return `Google lists "${slot.label}"`;
  const keyword = matchesAny(haystack(offering), slot.keywords);
  return keyword ? `menu mentions "${keyword}"` : null;
}

/** A competitor trades in this time slot? Returns the evidence, or null. */
export function tradesInSlot(offering: CompetitorOffering, slot: TimeSlot): string | null {
  const text = haystack(offering);
  const keyword = matchesAny(text, slot.keywords);
  return keyword ? `menu mentions "${keyword}"` : null;
}

/** A competitor covers this cuisine? Returns the evidence, or null. */
export function coversCuisine(
  offering: CompetitorOffering,
  cuisine: { typeSuffix?: string; keywords: string[]; label: string }
): string | null {
  if (cuisine.typeSuffix && offering.placeTypes.some((type) => type.toLowerCase().includes(cuisine.typeSuffix as string))) {
    return `Google classifies it as ${cuisine.label}`;
  }
  const keyword = matchesAny(haystack(offering), cuisine.keywords);
  return keyword ? `menu mentions "${keyword}"` : null;
}

/** Average menu price for an offering, from parsed items or the stored band. */
export function averagePrice(
  offering: { menuItems: MenuItem[]; priceRange?: { min: number | null; max: number | null } | null }
): number | null {
  const prices = offering.menuItems.map((item) => item.price).filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length > 0) return prices.reduce((total, price) => total + price, 0) / prices.length;
  const { min, max } = offering.priceRange ?? { min: null, max: null };
  if (min !== null && max !== null) return (min + max) / 2;
  if (min !== null) return min;
  if (max !== null) return max;
  return null;
}

/**
 * The confidence score. Deliberately simple and additive so an owner can be
 * told WHY a gap is 0.85 rather than 0.6:
 *
 *   0.50  base — a real gap, but detected from public data
 *   +0.15 the tenant ALREADY offers this, so it is actionable today
 *   +0.10 at least 5 competitors were analysed (not an artifact of 2 menus)
 *   +0.10 ZERO competitors offer it (rather than "almost none")
 *   ----
 *   0.95  cap — public data is never certain
 */
export function scoreGap(input: {
  competitorsOffering: number;
  competitorsAnalysed: number;
  tenantOffers: boolean;
  /** A "weak" gap (almost nobody, rather than nobody) scores lower. */
  weak?: boolean;
}): number {
  let score = 0.5;
  if (input.tenantOffers) score += 0.15;
  if (input.competitorsAnalysed >= MIN_CONFIDENT_SAMPLE) score += 0.1;
  if (input.competitorsOffering === 0) score += 0.1;
  if (input.weak) score -= 0.15;
  return Math.round(Math.max(0.05, Math.min(0.95, score)) * 100) / 100;
}

function withinRadius(offering: CompetitorOffering, radiusKm: number): boolean {
  // An unknown distance is not evidence of being outside the radius: a
  // hand-added competitor with no coordinates still competes for the same
  // diners.
  if (offering.distanceKm === null) return true;
  return offering.distanceKm <= radiusKm;
}

// -----------------------------------------------------------------------------
// Detectors
// -----------------------------------------------------------------------------

function detectMealGaps(input: OpportunityInput, inRadius: CompetitorOffering[]): Opportunity[] {
  const found: Opportunity[] = [];
  const tenantText = haystack(input.tenant);

  for (const slot of MEAL_SLOTS) {
    const offering = inRadius.filter((competitor) => servesMeal(competitor, slot) !== null);
    const tenantOffers =
      (slot.servesFlag !== undefined && input.tenant.serves.includes(slot.servesFlag)) ||
      matchesAny(tenantText, slot.keywords) !== null;

    // A gap is "nobody" (strong) or "almost nobody" (weak: at most one in ten).
    const isGap = offering.length === 0 || offering.length / Math.max(inRadius.length, 1) <= 0.1;
    if (!isGap || inRadius.length === 0) continue;

    const confidence = scoreGap({
      competitorsOffering: offering.length,
      competitorsAnalysed: inRadius.length,
      tenantOffers,
      weak: offering.length > 0,
    });

    const evidence: string[] = [
      `${offering.length} of ${inRadius.length} competitors within ${input.radiusKm ?? 5}km serve ${slot.label}`,
    ];
    if (offering.length > 0) evidence.push(`only ${offering.map((c) => c.name).slice(0, 3).join(', ')} do`);
    if (tenantOffers) evidence.push(`your own menu already covers ${slot.label}`);

    found.push({
      key: `meal_gap:${slot.key}`,
      opportunityType: 'meal_gap',
      title: `${offering.length === 0 ? 'No competitor offers' : `Only ${offering.length} competitor(s) offer`} ${slot.label}`,
      description:
        `${offering.length} of ${inRadius.length} nearby restaurants serve ${slot.label}. ` +
        (tenantOffers
          ? `You already do — say so loudly.`
          : `Nobody is competing for this daypart; a ${slot.label} offering would be close to uncontested.`),
      confidence,
      evidence,
    });
  }
  return found;
}

function detectTimeGaps(input: OpportunityInput, inRadius: CompetitorOffering[]): Opportunity[] {
  const found: Opportunity[] = [];
  const tenantText = `${haystack(input.tenant)} ${input.tenant.openingHours ?? ''}`.toLowerCase();

  for (const slot of TIME_SLOTS) {
    const offering = inRadius.filter((competitor) => tradesInSlot(competitor, slot) !== null);
    const tenantOffers = matchesAny(tenantText, slot.keywords) !== null;

    const isGap = offering.length === 0 || offering.length / Math.max(inRadius.length, 1) <= 0.1;
    if (!isGap || inRadius.length === 0) continue;

    const confidence = scoreGap({
      competitorsOffering: offering.length,
      competitorsAnalysed: inRadius.length,
      tenantOffers,
      weak: offering.length > 0,
    });

    const evidence: string[] = [
      `${offering.length} of ${inRadius.length} competitors within ${input.radiusKm ?? 5}km show evidence of ${slot.label}`,
    ];
    if (tenantOffers) evidence.push('your own menu/hours already cover this slot');

    found.push({
      key: `time_gap:${slot.key}`,
      opportunityType: 'time_gap',
      title: `${slot.label}: ${offering.length === 0 ? 'no competitor' : `only ${offering.length} competitor(s)`}`,
      description:
        `No nearby menu or listing mentions ${slot.label}. ` +
        (tenantOffers
          ? 'You already trade then — make sure diners can find that out.'
          : 'This daypart looks unserved in your area.'),
      confidence,
      evidence,
    });
  }
  return found;
}

function detectCuisineGaps(input: OpportunityInput, inRadius: CompetitorOffering[]): Opportunity[] {
  const found: Opportunity[] = [];
  const tenantText = haystack(input.tenant);

  for (const cuisine of CUISINES) {
    const offering = inRadius.filter((competitor) => coversCuisine(competitor, cuisine) !== null);
    const tenantOffers =
      (cuisine.typeSuffix !== undefined &&
        input.tenant.placeTypes.some((type) => type.toLowerCase().includes(cuisine.typeSuffix as string))) ||
      matchesAny(tenantText, cuisine.keywords) !== null;

    const isGap = offering.length === 0 || offering.length / Math.max(inRadius.length, 1) <= 0.1;
    if (!isGap || inRadius.length === 0) continue;

    const confidence = scoreGap({
      competitorsOffering: offering.length,
      competitorsAnalysed: inRadius.length,
      tenantOffers,
      weak: offering.length > 0,
    });

    const evidence: string[] = [
      `${offering.length} of ${inRadius.length} competitors within ${input.radiusKm ?? 5}km cover ${cuisine.label}`,
    ];
    if (tenantOffers) evidence.push(`your own menu already covers ${cuisine.label}`);

    found.push({
      key: `cuisine_gap:${cuisine.key}`,
      opportunityType: 'cuisine_gap',
      title: `${cuisine.label}: ${offering.length === 0 ? 'nobody nearby' : `only ${offering.length} nearby`}`,
      description:
        `${offering.length} of ${inRadius.length} nearby restaurants are ${cuisine.label}. ` +
        (tenantOffers
          ? 'That makes it a genuine unique selling point for you.'
          : `Adding ${cuisine.label} dishes would put you in an uncontested category.`),
      confidence,
      evidence,
    });
  }
  return found;
}

function detectPriceGaps(input: OpportunityInput, inRadius: CompetitorOffering[]): Opportunity[] {
  const found: Opportunity[] = [];

  const priced = inRadius
    .map((competitor) => ({ competitor, average: averagePrice(competitor) }))
    .filter((entry): entry is { competitor: CompetitorOffering; average: number } => entry.average !== null);

  // With no price evidence at all there is nothing to compare against, and
  // guessing a "budget gap" from silence would be exactly the invented
  // opportunity this module refuses to produce.
  if (priced.length === 0) return found;

  const tenantAverage = averagePrice(input.tenant);

  for (const band of PRICE_BANDS) {
    const inBand = priced.filter((entry) =>
      'max' in band ? entry.average <= band.max : entry.average >= (band as { min: number }).min
    );
    const isGap = inBand.length === 0 || inBand.length / priced.length <= 0.1;
    if (!isGap) continue;

    const tenantInBand =
      tenantAverage !== null && ('max' in band ? tenantAverage <= band.max : tenantAverage >= (band as { min: number }).min);

    const confidence = scoreGap({
      competitorsOffering: inBand.length,
      competitorsAnalysed: priced.length,
      tenantOffers: tenantInBand,
      weak: inBand.length > 0,
    });

    const bandLabel = 'max' in band ? `under R${band.max}` : `over R${(band as { min: number }).min}`;
    found.push({
      key: `price_gap:${band.key}`,
      opportunityType: 'price_gap',
      title: `No ${band.label} (${bandLabel}) option nearby`,
      description:
        `Only ${inBand.length} of ${priced.length} nearby restaurants with known prices average ${bandLabel} per dish. ` +
        (tenantInBand
          ? 'You already sit in that band — lead with it.'
          : `A ${band.label} menu tier would face almost no direct competition.`),
      confidence,
      evidence: [
        `${priced.length} competitors had a readable price band`,
        `${inBand.length} of them average ${bandLabel} per dish`,
        ...(tenantAverage !== null ? [`your own menu averages R${Math.round(tenantAverage)} per dish`] : []),
      ],
    });
  }
  return found;
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/**
 * Analyse a tenant's market and return the gaps, best first.
 *
 * With no competitors (or none with any readable data) this returns an empty
 * list rather than a list of guesses — an empty market report is honest, an
 * invented one is not.
 */
export function analyzeOpportunities(input: OpportunityInput): Opportunity[] {
  const radiusKm = input.radiusKm ?? 5;
  const inRadius = input.competitors.filter((competitor) => withinRadius(competitor, radiusKm));
  if (inRadius.length === 0) return [];

  const scoped: OpportunityInput = { ...input, radiusKm };
  const opportunities = [
    ...detectMealGaps(scoped, inRadius),
    ...detectTimeGaps(scoped, inRadius),
    ...detectCuisineGaps(scoped, inRadius),
    ...detectPriceGaps(scoped, inRadius),
  ];

  // Best first; ties broken deterministically so the dashboard order (and the
  // tests) never depend on object iteration order.
  return opportunities.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (a.opportunityType !== b.opportunityType) return a.opportunityType.localeCompare(b.opportunityType);
    return a.key.localeCompare(b.key);
  });
}

/** "No competitor offers Sunday brunch within 5km. Opportunity score: 0.85" */
export function formatOpportunity(opportunity: Opportunity, radiusKm = 5): string {
  return `${opportunity.title} within ${radiusKm}km. Opportunity score: ${opportunity.confidence.toFixed(2)}`;
}

/** Convenience for callers that stored a price_range string. */
export function priceRangeFromString(value: string | null): { min: number | null; max: number | null } | null {
  const parsed = parsePriceRange(value);
  if (parsed.min === null && parsed.max === null) return null;
  return { min: parsed.min, max: parsed.max };
}
