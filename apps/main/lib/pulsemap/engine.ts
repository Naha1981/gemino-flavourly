/**
 * GATE PM-1 — simulation orchestration.
 *
 * One entry point decides which forecast path runs:
 *   - 'demo'  → deterministic demo forecast (Demo Mode ON only; sample data,
 *               no external calls, clearly labelled);
 *   - 'live'  → the approved AI provider chain, gated by the PII tripwire.
 *
 * LIVE FAILURE IS HONEST: no key / network error / bad JSON →
 * status 'unavailable' with a reason. NEVER a fabricated score.
 */
import { generateDemoForecast } from './demo-forecast.ts';
import { generateForecastWithAI, type FetchLike } from './ai.ts';
import { assertContextIsPIIFree } from './aggregate.ts';
import { SIMULATION_UNAVAILABLE_MESSAGE, type SimulationContext, type SimulationOutcome } from './types.ts';
import { createHash } from 'node:crypto';

/**
 * Cache key: sha256 over everything that materially changes a forecast —
 * the draft text, the target segment, the segment counts (aggregates only),
 * the source mode, and past-campaign counts. Identical inputs reuse the
 * stored simulation instead of re-spending AI budget.
 */
export function hashSimulationInput(input: {
  draft: SimulationContext['draft'];
  segmentCounts: Array<{ segment: string; count: number }>;
  source: string;
  pastCampaignCount: number;
  reviewTotal: number;
  competitorCount: number;
}): string {
  const stable = {
    title: input.draft.title.trim(),
    message: input.draft.message.trim(),
    offer: (input.draft.offer ?? '').trim() || null,
    targetSegment: input.draft.targetSegment,
    sendAt: input.draft.sendAt,
    segmentCounts: [...input.segmentCounts].sort((a, b) => a.segment.localeCompare(b.segment)),
    source: input.source,
    pastCampaignCount: input.pastCampaignCount,
    reviewTotal: input.reviewTotal,
    competitorCount: input.competitorCount,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export interface RunSimulationOptions {
  mode: 'live' | 'demo';
  /** Injectable for tests; defaults to the real provider chain. */
  generate?: FetchLike;
}

/**
 * Run the simulation. Pure orchestration — the route supplies the context
 * (already tenant-scoped + demo-scoped) and persists the outcome.
 */
export async function runSimulation(
  ctx: SimulationContext,
  options: RunSimulationOptions,
): Promise<SimulationOutcome> {
  if (options.mode === 'demo') {
    // Deterministic sample-data forecast. No external calls, no PII surface.
    return {
      status: 'complete',
      source: 'demo',
      model: 'demo:deterministic',
      forecast: generateDemoForecast(ctx),
      reason: null,
    };
  }

  // LIVE mode — PII tripwire first: the SYNTHESIZED context (aggregates,
  // themes, signals) must be identifier-free. The owner's own draft text is
  // deliberately outside the guard: it is the message they intend to send
  // publicly (and may legitimately contain the restaurant's own number).
  try {
    assertContextIsPIIFree({
      segmentSummaries: ctx.segmentSummaries,
      pastCampaigns: ctx.pastCampaigns,
      reviewSignal: ctx.reviewSignal,
      marketSignal: ctx.marketSignal,
    });
  } catch {
    return {
      status: 'unavailable',
      source: 'ai',
      model: null,
      forecast: null,
      reason: SIMULATION_UNAVAILABLE_MESSAGE,
    };
  }

  const result = await generateForecastWithAI(ctx, options.generate);
  if (!result) {
    return {
      status: 'unavailable',
      source: 'ai',
      model: null,
      forecast: null,
      reason: SIMULATION_UNAVAILABLE_MESSAGE,
    };
  }

  return {
    status: 'complete',
    source: 'ai',
    model: result.model,
    forecast: result.forecast,
    reason: null,
  };
}
