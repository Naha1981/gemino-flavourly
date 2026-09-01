/**
 * GATE PM-1 — the LLM prompt builder for live simulations.
 *
 * The prompt is assembled ONLY from: the owner's own campaign draft, the
 * restaurant's public context, anonymized segment summaries (counts +
 * averages), the tenant's own past campaign stats, public review signals
 * (rating counts + locally extracted theme words), and public market
 * signals (competitor counts/ratings). The engine runs `assertContextIsPIIFree`
 * on the serialized context before this prompt is ever sent.
 */
import type { SimulationContext } from './types.ts';

function segmentLines(ctx: SimulationContext): string {
  if (ctx.segmentSummaries.length === 0) return 'No customer segments yet.';
  return ctx.segmentSummaries
    .map(
      (s) =>
        `- ${s.segment}: ${s.count} guests, avg ${s.avgVisits} visits, avg spend R${Math.round(s.avgSpendCents / 100)}, ${
          s.avgDaysSinceLastVisit === null ? 'no recent visit data' : `last visit ~${s.avgDaysSinceLastVisit} days ago`
        }`,
    )
    .join('\n');
}

function pastCampaignLines(ctx: SimulationContext): string {
  if (ctx.pastCampaigns.length === 0) return 'No past campaigns yet.';
  return ctx.pastCampaigns
    .slice(0, 10)
    .map(
      (c) =>
        `- "${c.name}" (${c.status}${c.targetSegment ? `, targeted ${c.targetSegment}` : ''}) — sent ${c.sentCount ?? 0}, est. reach ${c.estimatedReach ?? 0}`,
    )
    .join('\n');
}

function reviewLine(ctx: SimulationContext): string {
  const r = ctx.reviewSignal;
  if (!r || r.totalReviews === 0) return 'No review data yet.';
  const themes = r.themes.length > 0 ? ` Guests most often mention: ${r.themes.slice(0, 6).join(', ')}.` : '';
  return `${r.totalReviews} public reviews, average rating ${r.avgRating?.toFixed(1) ?? 'n/a'}.${themes}`;
}

function marketLine(ctx: SimulationContext): string {
  const m = ctx.marketSignal;
  if (!m || m.competitorCount === 0) return 'No competitor data yet.';
  return `${m.competitorCount} tracked competitors, avg rating ${m.avgCompetitorRating?.toFixed(1) ?? 'n/a'}, ${m.activePromotions} active promotions.`;
}

export const PULSEMAP_SYSTEM_PROMPT = `You are PulseMap, the pre-launch campaign reaction forecaster for Flavourly, a WhatsApp-first restaurant revenue platform in South Africa.

Your job: predict how a restaurant's own customer segments will likely react to a WhatsApp campaign BEFORE it is sent. You are not a copywriter — you are the pre-launch intelligence layer. You forecast, the owner decides.

STRICT RULES:
- Ground every judgement in the segment data provided. If data is thin, say so and lower confidence.
- Write for a busy restaurant owner: plain language, no marketing jargon, no hype.
- Never guarantee customer behaviour. You forecast LIKELY reactions.
- All money is South African Rand (R).
- "purchaseIntent" scores are 0-100 (0 = will ignore, 100 = will book).
- improvedCopy must keep the SAME offer and facts as the original draft (rephrase for clarity and appeal — never invent new prices, dates, or dishes).
- Reply with ONLY a valid JSON object, no markdown fences, in this exact shape:
{
  "score": <integer 0-100>,
  "readiness": "ready" | "improve" | "rework",
  "bestSegment": "vip" | "regular" | "at_risk" | "dormant" | "new",
  "purchaseIntent": "<one plain-language sentence>",
  "objections": ["<up to 6 short strings>"],
  "likelyReplies": ["<up to 6 short WhatsApp replies a guest would actually type>"],
  "riskFlags": ["<up to 4 short strings>"],
  "improvedCopy": "<the improved WhatsApp message, max ~450 chars, same offer>",
  "explanation": "<2-4 sentences, plain restaurant-owner language, why you scored it this way>",
  "confidence": "low" | "medium" | "high",
  "assumptions": ["<up to 5 short strings>"],
  "segmentReactions": [
    { "segment": "vip", "reaction": "<one sentence>", "purchaseIntent": <integer 0-100>, "primaryObjection": "<short string or null>" }
  ]
}
segmentReactions must include one entry per segment given in the input.`;

export function buildForecastUserPrompt(ctx: SimulationContext): string {
  const d = ctx.draft;
  return `RESTAURANT: ${ctx.restaurant.name}
${ctx.restaurant.description ? `About: ${ctx.restaurant.description}` : ''}
${ctx.restaurant.openingHours ? `Hours: ${ctx.restaurant.openingHours}` : ''}

CAMPAIGN DRAFT:
- Title: ${d.title}
- Message: ${d.message}
- Offer: ${d.offer ?? '(none stated)'}
- Target segment: ${d.targetSegment ?? '(not chosen — assess all segments)'}
- Intended send: ${d.sendAt ?? '(undecided)'}

CUSTOMER SEGMENTS (aggregated, anonymized):
${segmentLines(ctx)}

PAST CAMPAIGNS (this restaurant's own):
${pastCampaignLines(ctx)}

PUBLIC REVIEWS: ${reviewLine(ctx)}
LOCAL MARKET: ${marketLine(ctx)}

Forecast how each segment will likely react to this campaign before it is sent. Respond with the JSON object only.`;
}
