/**
 * GATE PM-1 — the live AI forecast call + strict validation.
 *
 * Uses the SAME approved provider chain as the rest of the app
 * (Groq openai/gpt-oss-20b first, Gemini fallback — see
 * lib/ai/responder.ts). Injects `fetch` so tests can fake providers.
 *
 * HONESTY CONTRACT: any failure (no key, network error, bad JSON,
 * validation failure) returns `null` — the route then reports
 * "Simulation unavailable right now" with NO fake scores. The model never
 * sees raw numbers to crunch: segment counts/averages are computed in SQL,
 * the LLM only judges and words.
 */
import { buildForecastUserPrompt, PULSEMAP_SYSTEM_PROMPT } from './prompt.ts';
import {
  PULSEMAP_SEGMENTS,
  isPulseMapSegment,
  type Forecast,
  type PulseMapSegment,
  type SegmentReaction,
  type SimulationContext,
} from './types.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface AIForecastResult {
  forecast: Forecast;
  model: string;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function asStringArray(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, cap);
}

function readinessFromScore(score: number): 'ready' | 'improve' | 'rework' {
  if (score >= 72) return 'ready';
  if (score >= 50) return 'improve';
  return 'rework';
}

/**
 * Validate + normalize an LLM forecast. Hard requirements (score,
 * segmentReactions, improvedCopy, explanation): a forecast missing them is
 * REJECTED (returns null) — half-fabricated forecasts are worse than none.
 * Soft fields get safe derivations (e.g. readiness derives from score).
 */
export function validateForecast(raw: unknown, ctx: SimulationContext): Forecast | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const score = clampInt(r.score, 0, 100, -1);
  if (score < 0) return null;

  const improvedCopy = typeof r.improvedCopy === 'string' ? r.improvedCopy.trim() : '';
  if (improvedCopy.length < 20 || improvedCopy.length > 600) return null;

  const explanation = typeof r.explanation === 'string' ? r.explanation.trim() : '';
  if (explanation.length < 10) return null;

  if (!Array.isArray(r.segmentReactions) || r.segmentReactions.length === 0) return null;
  const seen = new Set<PulseMapSegment>();
  const segmentReactions: SegmentReaction[] = [];
  for (const entry of r.segmentReactions) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const segment = e.segment;
    if (!isPulseMapSegment(segment) || seen.has(segment)) continue;
    seen.add(segment);
    segmentReactions.push({
      segment,
      reaction: asString(e.reaction, 'No reaction provided.'),
      purchaseIntent: clampInt(e.purchaseIntent, 0, 100, 0),
      primaryObjection:
        typeof e.primaryObjection === 'string' && e.primaryObjection.trim().length > 0
          ? e.primaryObjection.trim()
          : null,
    });
  }
  if (segmentReactions.length === 0) return null;
  // Fill any input segment the model skipped with an honest placeholder.
  for (const segment of PULSEMAP_SEGMENTS) {
    if (!seen.has(segment) && ctx.segmentSummaries.some((s) => s.segment === segment)) {
      segmentReactions.push({
        segment,
        reaction: 'The model did not assess this segment — treat as unknown.',
        purchaseIntent: 0,
        primaryObjection: null,
      });
    }
  }

  let readiness: 'ready' | 'improve' | 'rework' = readinessFromScore(score);
  if (r.readiness === 'ready' || r.readiness === 'improve' || r.readiness === 'rework') {
    readiness = r.readiness;
  }

  let bestSegment = isPulseMapSegment(r.bestSegment) ? r.bestSegment : null;
  if (!bestSegment) {
    bestSegment = segmentReactions.reduce<SegmentReaction | null>(
      (acc, x) => (acc === null || x.purchaseIntent > acc.purchaseIntent ? x : acc),
      null,
    )?.segment ?? null;
  }

  let confidence: 'low' | 'medium' | 'high' = 'low';
  if (r.confidence === 'low' || r.confidence === 'medium' || r.confidence === 'high') {
    confidence = r.confidence;
  }

  return {
    score,
    readiness,
    bestSegment,
    purchaseIntent: asString(r.purchaseIntent, 'Purchase intent not summarized.'),
    objections: asStringArray(r.objections, 6),
    likelyReplies: asStringArray(r.likelyReplies, 6),
    riskFlags: asStringArray(r.riskFlags, 4),
    improvedCopy,
    explanation,
    confidence,
    assumptions: asStringArray(r.assumptions, 5),
    segmentReactions,
  };
}

/** Strip markdown fences the model sometimes wraps JSON in. */
function extractJSONObject(text: string): unknown | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Run the live forecast: Groq → Gemini, mirroring the app's provider chain.
 * Returns null on ANY failure — honest unavailability.
 */
export async function generateForecastWithAI(
  ctx: SimulationContext,
  fetchImpl: FetchLike = ((url, init) => fetch(url, init)) as FetchLike,
): Promise<AIForecastResult | null> {
  const userPrompt = buildForecastUserPrompt(ctx);
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!groqKey && !geminiKey) return null;

  if (groqKey) {
    try {
      const res = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          messages: [
            { role: 'system', content: PULSEMAP_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 1400,
          temperature: 0.4,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        const parsed = typeof content === 'string' ? extractJSONObject(content) : null;
        const forecast = validateForecast(parsed, ctx);
        if (forecast) return { forecast, model: 'groq:openai/gpt-oss-20b' };
      } else {
        console.error(`[PulseMap] Groq request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      }
    } catch (err) {
      console.error('[PulseMap] Groq call threw:', err);
    }
  }

  if (geminiKey) {
    try {
      const res = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: PULSEMAP_SYSTEM_PROMPT }] },
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig: { maxOutputTokens: 1400, temperature: 0.4 },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (res.ok) {
        const data = await res.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = typeof content === 'string' ? extractJSONObject(content) : null;
        const forecast = validateForecast(parsed, ctx);
        if (forecast) return { forecast, model: 'gemini:gemini-3.5-flash' };
      } else {
        console.error(`[PulseMap] Gemini request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      }
    } catch (err) {
      console.error('[PulseMap] Gemini call threw:', err);
    }
  }

  return null;
}
