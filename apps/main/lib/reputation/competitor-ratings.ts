/**
 * Gate #14 — competitor rating monitoring logic, framework-free.
 *
 * Pure decision functions (drop detection, alert copy, trend) plus the
 * framework-free cron runner. The Drizzle adapter lives in
 * competitor-store.ts; tests exercise everything with in-memory fakes.
 */

/** A drop is "significant" at 0.2 stars or more (the gate contract). */
export const RATING_DROP_THRESHOLD = 0.2;

/**
 * Float-tolerant magnitude comparison: 4.5 - 4.3 is 0.19999999999999996 in
 * IEEE-754, and a spec that says "0.2 or more" must not lose an exact
 * 0.2-fall to representation error.
 */
const EPSILON = 1e-9;

function fellAtLeast(previous: number, current: number, magnitude: number): boolean {
  return previous - current >= magnitude - EPSILON;
}

export type CompetitorTrend = 'up' | 'down' | 'stable';

export interface RatingReading {
  rating: number;
  reviewCount: number;
  recordedAt: Date;
}

export interface CompetitorRecord {
  id: string;
  tenantId: string;
  name: string;
  /**
   * Nullable since Gate #15: the market-intelligence engine adds competitors
   * discovered by Places search or typed in by hand, and a hand-added one may
   * have no Google listing at all. Such rows are skipped by this sweep (there
   * is nothing to poll) but are still tracked for menu/promotion changes.
   */
  googlePlaceId: string | null;
  currentRating: number;
  reviewCount: number;
  lastCheckAt: Date | null;
}

/** True when `current` fell 0.2+ stars below `previous`. */
export function isSignificantRatingDrop(previous: number, current: number): boolean {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return false;
  return fellAtLeast(previous, current, RATING_DROP_THRESHOLD);
}

/**
 * Alert copy for a significant drop. Ratings render with one decimal so
 * "4.6 -> 4.3" reads as exactly the 0.3-star fall it is.
 */
export function formatRatingDropAlert(competitorName: string, previousRating: number, newRating: number): string {
  return (
    `⚠️ Competitor Alert: ${competitorName} rating dropped from ` +
    `${previousRating.toFixed(1)} to ${newRating.toFixed(1)}. This is an opportunity to highlight your superior service.`
  );
}

/**
 * Trend across a rating history window: compares the newest reading to the
 * oldest inside the window. Fewer than two readings is 'stable' (nothing to
 * compare — not an opinion about direction).
 */
export function trendOf(readings: RatingReading[]): CompetitorTrend {
  if (readings.length < 2) return 'stable';
  const sorted = [...readings].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  const first = sorted[0].rating;
  const last = sorted[sorted.length - 1].rating;
  if (fellAtLeast(last, first, RATING_DROP_THRESHOLD)) return 'up';
  if (fellAtLeast(first, last, RATING_DROP_THRESHOLD)) return 'down';
  return 'stable';
}

// -----------------------------------------------------------------------------
// Cron runner
// -----------------------------------------------------------------------------

/** What the runner needs from the Places client (injectable for tests). */
export type FetchPlaceRatingFn = (
  placeId: string,
  apiKey: string,
  options?: { now?: Date; fetchImpl?: typeof fetch }
) => Promise<{ rating: number; reviewCount: number } | null>;

export interface CompetitorRatingsStore {
  /** Every competitor across every tenant (the cron is platform-wide). */
  findAllCompetitors(): Promise<CompetitorRecord[]>;
  /** The reading BEFORE this check (for drop detection). */
  getPreviousReading(competitorId: string): Promise<RatingReading | null>;
  /** Persist the new reading: update current + append history row. */
  recordReading(competitorId: string, rating: number, reviewCount: number, at: Date): Promise<void>;
  /** Surface the alert in the tenant's inbox as a system message. */
  createAlert(tenantId: string, text: string): Promise<void>;
}

export interface CompetitorRatingsOptions {
  now?: Date;
  /** Platform-level API key (per-tenant keys are for their OWN place). */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  fetchPlaceRatingFn?: FetchPlaceRatingFn;
  /** Ceiling on competitors checked per run. */
  limit?: number;
}

export interface CompetitorRatingsSummary {
  competitorsChecked: number;
  ratingsRecorded: number;
  alertsCreated: number;
  /** `competitorsChecked` counts every swept row, including the ones skipped below. */
  skipped: { noApiKey: number; noPlaceId: number; fetchFailed: number; noRating: number; failed: number };
  samples: Array<{ competitorId: string; name: string; previous: number | null; current: number; alert: boolean }>;
}

const DEFAULT_LIMIT = 500;

function positiveLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_LIMIT;
}

/**
 * One sweep: for every tracked competitor, pull its current Google rating,
 * append a history reading, and raise an inbox alert when it dropped 0.2+
 * stars since the previous reading.
 *
 * Competitor monitoring is platform-level intelligence (the tenant watches
 * OTHER businesses' listings), so the Places key is the deployment's own
 * GOOGLE_PLACES_API_KEY — not the tenant's key, which is only authorized
 * for the tenant's own place.
 */
export async function runCompetitorRatingsCron(
  store: CompetitorRatingsStore,
  options: CompetitorRatingsOptions = {}
): Promise<CompetitorRatingsSummary> {
  const now = options.now ?? new Date();
  const apiKey = options.apiKey ?? process.env.GOOGLE_PLACES_API_KEY ?? '';
  const doFetch = options.fetchPlaceRatingFn;

  const summary: CompetitorRatingsSummary = {
    competitorsChecked: 0,
    ratingsRecorded: 0,
    alertsCreated: 0,
    skipped: { noApiKey: 0, noPlaceId: 0, fetchFailed: 0, noRating: 0, failed: 0 },
    samples: [],
  };

  if (!apiKey) {
    console.error(
      '[CompetitorRatings] GOOGLE_PLACES_API_KEY is not set — competitor rating monitoring cannot run'
    );
    summary.skipped.noApiKey = 1;
    return summary;
  }

  let competitors: CompetitorRecord[] = [];
  try {
    competitors = await store.findAllCompetitors();
  } catch (err) {
    console.error('[CompetitorRatings] Failed to load competitors', err);
    summary.skipped.failed += 1;
    return summary;
  }

  for (const competitor of competitors) {
    if (summary.competitorsChecked >= positiveLimit(options.limit)) break;
    summary.competitorsChecked += 1;

    if (!competitor.googlePlaceId) {
      // A hand-added / market-discovered competitor with no Google listing:
      // nothing to poll. Counted separately from fetchFailed so a long list of
      // manual competitors cannot look like a broken Places integration.
      summary.skipped.noPlaceId += 1;
      continue;
    }

    try {
      const fetched = doFetch
        ? await doFetch(competitor.googlePlaceId, apiKey, { now })
        : null;
      if (!fetched) {
        // API reachable but no rating for this listing (new/removed place).
        summary.skipped.noRating += 1;
        continue;
      }

      const previous = await store.getPreviousReading(competitor.id);
      await store.recordReading(competitor.id, fetched.rating, fetched.reviewCount, now);
      summary.ratingsRecorded += 1;

      const dropped = previous ? isSignificantRatingDrop(previous.rating, fetched.rating) : false;
      if (dropped && previous) {
        const alertText = formatRatingDropAlert(competitor.name, previous.rating, fetched.rating);
        await store.createAlert(competitor.tenantId, alertText);
        summary.alertsCreated += 1;
      }

      if (summary.samples.length < 5) {
        summary.samples.push({
          competitorId: competitor.id,
          name: competitor.name,
          previous: previous ? previous.rating : null,
          current: fetched.rating,
          alert: dropped,
        });
      }
    } catch (err) {
      // Place-level failure (bad place id, quota, transport): counted, and
      // the sweep continues — one dead listing must not starve the rest.
      summary.skipped.fetchFailed += 1;
      console.error(`[CompetitorRatings] Failed to check competitor ${competitor.id}`, err);
    }
  }

  return summary;
}
