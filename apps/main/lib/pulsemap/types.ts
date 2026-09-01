/**
 * GATE PM-1 — PulseMap campaign reaction simulator: shared types.
 *
 * Framework-free (no Next/Drizzle imports) so the simulation logic is
 * unit-testable and reusable at route boundaries.
 *
 * THE PII CONTRACT: every type that crosses toward the LLM carries only
 * aggregated, anonymized data — per-segment counts and averages. Names,
 * phone numbers, and message transcripts never enter this module's
 * AI-facing surface.
 */

export const PULSEMAP_SEGMENTS = ['vip', 'regular', 'at_risk', 'dormant', 'new'] as const;
export type PulseMapSegment = (typeof PULSEMAP_SEGMENTS)[number];

export function isPulseMapSegment(value: unknown): value is PulseMapSegment {
  return typeof value === 'string' && (PULSEMAP_SEGMENTS as readonly string[]).includes(value);
}

/** Anonymized per-segment aggregate (count + averages only — no PII). */
export interface SegmentSummary {
  segment: PulseMapSegment;
  count: number;
  avgVisits: number;
  avgSpendCents: number;
  /** Average days since last visit (null = never / unknown). */
  avgDaysSinceLastVisit: number | null;
}

/** The campaign draft being simulated (the owner's own text). */
export interface CampaignDraft {
  title: string;
  message: string;
  offer: string | null;
  targetSegment: string | null;
  /** Intended send date/time (ISO or null = undecided). */
  sendAt: string | null;
}

/** Restaurant context the forecast is grounded in (no customer data). */
export interface RestaurantContext {
  name: string;
  description: string | null;
  openingHours: string | null;
}

/** Past campaign performance rows (aggregated, tenant's own campaigns). */
export interface PastCampaignStat {
  name: string;
  status: string;
  targetSegment: string | null;
  sentCount: number | null;
  estimatedReach: number | null;
  estimatedRevenueCents: number | null;
}

/** Public review signal (rating distribution + locally-extracted themes). */
export interface ReviewSignal {
  totalReviews: number;
  avgRating: number | null;
  /** Top recurring words from review text, extracted locally (no PII). */
  themes: string[];
}

/** Public market signal (competitor names/ratings/promotion counts). */
export interface MarketSignal {
  competitorCount: number;
  avgCompetitorRating: number | null;
  activePromotions: number;
}

/** Everything the forecast generator is allowed to see. */
export interface SimulationContext {
  draft: CampaignDraft;
  restaurant: RestaurantContext;
  segmentSummaries: SegmentSummary[];
  pastCampaigns: PastCampaignStat[];
  reviewSignal: ReviewSignal | null;
  marketSignal: MarketSignal | null;
}

/** One row of the segment reaction matrix. */
export interface SegmentReaction {
  segment: PulseMapSegment;
  /** Plain restaurant-owner language. */
  reaction: string;
  /** 0–100 predicted purchase intent for this segment. */
  purchaseIntent: number;
  primaryObjection: string | null;
}

export type Readiness = 'ready' | 'improve' | 'rework';
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/** The forecast itself. */
export interface Forecast {
  /** 0–100 overall campaign score. */
  score: number;
  readiness: Readiness;
  bestSegment: PulseMapSegment | null;
  /** Plain-language purchase-intent summary. */
  purchaseIntent: string;
  objections: string[];
  likelyReplies: string[];
  riskFlags: string[];
  improvedCopy: string;
  /** Why — in plain restaurant-owner language. */
  explanation: string;
  confidence: ConfidenceLevel;
  assumptions: string[];
  segmentReactions: SegmentReaction[];
}

export type SimulationSource = 'ai' | 'demo';

/** Result of a simulation run. `unavailable` NEVER carries fake scores. */
export interface SimulationOutcome {
  status: 'complete' | 'unavailable';
  source: SimulationSource;
  /** Provider + model tag, e.g. 'groq:openai/gpt-oss-20b' or 'demo:deterministic'. */
  model: string | null;
  forecast: Forecast | null;
  /** Set when status = 'unavailable' — the honest reason. */
  reason: string | null;
}

export const FORECAST_DISCLAIMER =
  'Forecast only. Real results are measured after launch.';

export const SIMULATION_UNAVAILABLE_MESSAGE =
  'Simulation unavailable right now. No scores were generated and nothing was sent — try again in a moment.';
