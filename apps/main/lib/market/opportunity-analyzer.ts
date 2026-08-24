/**
 * Gate #17 — market opportunity detection, framework-free.
 *
 * Input: the competitor set's aggregated evidence (menu texts, parsed
 * items, price levels). Output: opportunities with confidence scores.
 *
 * Confidence is deterministic and evidence-scaled: an offering missing
 * from ALL competitors is more remarkable when more competitors were
 * scanned (0 competitors scanned is NO evidence — the analyzer refuses to
 * invent opportunities from an empty market, the same honesty rule as the
 * reputation and revenue engines).
 *
 *   scanned 0     -> no opportunities (no evidence)
 *   scanned 1-2   -> confidence 0.5-0.65 band
 *   scanned 3-5   -> 0.7-0.85 band
 *   scanned 6+    -> 0.9 band
 *
 * Coveredness is keyword-based over menu text + item names: crude but
 * explainable, and every opportunity carries the evidence it was derived
 * from so the owner can judge it.
 */

export interface CompetitorEvidence {
  name: string;
  /** Raw menu page text (latest snapshot), if any. */
  menuText: string | null;
  /** Parsed items (latest snapshot), if any. */
  items: Array<{ name: string; priceCents: number }>;
  /** Google price level 0-4 as discovered. */
  priceLevel: number | null;
}

export type OpportunityCategory = 'meal_type' | 'cuisine' | 'price_point' | 'time_slot';

export interface Opportunity {
  opportunityKey: string;
  category: OpportunityCategory;
  description: string;
  /** 0..1, evidence-scaled. */
  confidence: number;
  evidence: {
    competitorsScanned: number;
    competitorsWithMenus: number;
    coveredBy: string[];
    radiusKm?: number;
  };
}

interface Offering {
  key: string;
  category: OpportunityCategory;
  label: string;
  patterns: RegExp[];
  description: string;
}

const OFFERINGS: Offering[] = [
  {
    key: 'meal_type:breakfast',
    category: 'meal_type',
    label: 'breakfast',
    patterns: [/\bbreakfast\b/i],
    description: 'No competitor in your area offers breakfast',
  },
  {
    key: 'meal_type:brunch',
    category: 'meal_type',
    label: 'brunch',
    patterns: [/\bbrunch\b/i],
    description: 'No competitor offers brunch',
  },
  {
    key: 'meal_type:late_night',
    category: 'meal_type',
    label: 'late-night dining',
    patterns: [/\blate[\s-]?night\b/i, /until\s+(?:1am|2am|midnight|23h|00h)/i],
    description: 'No competitor offers late-night dining',
  },
  {
    key: 'cuisine:vegan',
    category: 'cuisine',
    label: 'vegan',
    patterns: [/\bvegan\b/i],
    description: 'No competitor offers a vegan menu',
  },
  {
    key: 'cuisine:vegetarian',
    category: 'cuisine',
    label: 'dedicated vegetarian',
    patterns: [/\bvegetarian\b/i],
    description: 'No competitor offers dedicated vegetarian options',
  },
  {
    key: 'cuisine:gluten_free',
    category: 'cuisine',
    label: 'gluten-free',
    patterns: [/\bgluten[\s-]?free\b/i, /\bhalaal\b.*\bgf\b/i],
    description: 'No competitor offers gluten-free options',
  },
  {
    key: 'cuisine:halaal',
    category: 'cuisine',
    label: 'halaal',
    patterns: [/\bhalaal\b/i, /\bhalal\b/i],
    description: 'No competitor advertises halaal',
  },
  {
    key: 'cuisine:kosher',
    category: 'cuisine',
    label: 'kosher',
    patterns: [/\bkosher\b/i],
    description: 'No competitor advertises kosher',
  },
  {
    key: 'time_slot:sunday_brunch',
    category: 'time_slot',
    label: 'Sunday brunch',
    patterns: [/\bsunday\b/i, /\bsondag\b/i],
    description: 'No competitor mentions Sunday offerings',
  },
  {
    key: 'time_slot:weekend_breakfast',
    category: 'time_slot',
    label: 'weekend breakfast',
    patterns: [/\bweekend\b/i, /\bsaturday\b/i],
    description: 'No competitor mentions weekend-specific offerings',
  },
];

/** Budget/premium thresholds (rand, per item). */
const BUDGET_RANDS = 80;
const PREMIUM_RANDS = 300;

function evidenceText(competitor: CompetitorEvidence): string {
  const itemNames = competitor.items.map((item) => item.name).join('\n');
  return `${competitor.menuText ?? ''}\n${itemNames}`;
}

function confidenceFor(scanned: number): number {
  if (scanned <= 0) return 0;
  if (scanned <= 2) return 0.5 + 0.05 * scanned; // 0.55 .. 0.6
  if (scanned <= 5) return 0.7 + 0.05 * (scanned - 3); // 0.7 .. 0.85
  return 0.9;
}

/** All prices seen across the market's parsed items (in rands). */
function marketPrices(competitors: CompetitorEvidence[]): number[] {
  const prices: number[] = [];
  for (const competitor of competitors) {
    for (const item of competitor.items) prices.push(item.priceCents / 100);
  }
  return prices;
}

export function analyzeOpportunities(
  competitors: CompetitorEvidence[],
  options: { radiusKm?: number } = {}
): Opportunity[] {
  if (competitors.length === 0) return [];

  const scanned = competitors.length;
  const withMenus = competitors.filter((c) => (c.menuText ?? '').length > 0 || c.items.length > 0);
  const baseConfidence = confidenceFor(scanned);
  const opportunities: Opportunity[] = [];

  // ---- keyword-based offering gaps ----------------------------------------
  for (const offering of OFFERINGS) {
    const coveredBy: string[] = [];
    for (const competitor of withMenus) {
      if (offering.patterns.some((pattern) => pattern.test(evidenceText(competitor)))) {
        coveredBy.push(competitor.name);
      }
    }
    if (coveredBy.length === 0 && withMenus.length > 0) {
      // Missing from every SCANNED menu — but only remarkable if we
      // actually have menus to scan; no-menu evidence weakens the claim.
      const menuPenalty = withMenus.length < scanned ? 0.1 : 0;
      opportunities.push({
        opportunityKey: offering.key,
        category: offering.category,
        description: offering.description,
        confidence: Math.max(0.3, Math.min(0.95, baseConfidence - menuPenalty)),
        evidence: {
          competitorsScanned: scanned,
          competitorsWithMenus: withMenus.length,
          coveredBy: [],
          radiusKm: options.radiusKm,
        },
      });
    }
  }

  // ---- price-point gaps ----------------------------------------------------
  const prices = marketPrices(competitors);
  if (prices.length > 0) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    if (min > BUDGET_RANDS) {
      opportunities.push({
        opportunityKey: 'price_point:budget',
        category: 'price_point',
        description: `No competitor prices below R${BUDGET_RANDS} — a budget tier (cheapest parsed item R${min.toFixed(0)}) is uncovered`,
        confidence: Math.min(0.95, baseConfidence),
        evidence: { competitorsScanned: scanned, competitorsWithMenus: withMenus.length, coveredBy: [], radiusKm: options.radiusKm },
      });
    }
    if (max < PREMIUM_RANDS) {
      opportunities.push({
        opportunityKey: 'price_point:premium',
        category: 'price_point',
        description: `No competitor prices above R${PREMIUM_RANDS} — a premium tier (highest parsed item R${max.toFixed(0)}) is uncovered`,
        confidence: Math.min(0.95, baseConfidence),
        evidence: { competitorsScanned: scanned, competitorsWithMenus: withMenus.length, coveredBy: [], radiusKm: options.radiusKm },
      });
    }
  }

  return opportunities;
}
