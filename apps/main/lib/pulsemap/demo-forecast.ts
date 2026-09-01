/**
 * GATE PM-1 — the deterministic DEMO forecast.
 *
 * Used ONLY when Demo Mode is ON (super-admin view toggle): it forecasts
 * from the deadbeef sample dataset using fixed, explainable rules — no
 * external LLM call, so demo screenshots never spend AI budget and never
 * depend on provider availability.
 *
 * HONESTY RULE: results are clearly labelled as demo output (confidence
 * 'low', explanation says so, model tag 'demo:deterministic'). It is a
 * demonstration of the product, never presented as a live prediction.
 */
import type {
  ConfidenceLevel,
  Forecast,
  PulseMapSegment,
  Readiness,
  SegmentReaction,
  SimulationContext,
  SegmentSummary,
} from './types.ts';

interface DraftSignals {
  hasPrice: boolean;
  hasDay: boolean;
  hasCTA: boolean;
  discountHeavy: boolean;
  hasUrgency: boolean;
  hasFood: boolean;
  tooShort: boolean;
  tooLong: boolean;
}

const FOOD_WORDS = /\b(menu|dinner|lunch|breakfast|brunch|braai|burger|steak|pasta|seafood|platter|dessert|biryani|pizza|sushi|curry|tasting|set menu|supper|meal|dish|kitchen|table|bottle|wine|cocktail|coffee|family|date night|two|kids)\b/i;
const DAY_WORDS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tonight|tomorrow|this week|this weekend|weekend)\b/i;
const CTA_WORDS = /\b(book|reserve|reply|whatsapp|call|dm|claim|snap|grab|secure|confirm)\b/i;
const DISCOUNT_WORDS = /\b(\d{1,3}\s?%|percent|off|free|cheap|deal|half price|special price|discount|giveaway)\b/i;
const URGENCY_WORDS = /\b(only|limited|ends|last|final|tonight only|before|few (?:tables|seats|spots)|going fast)\b/i;
const PRICE_PATTERN = /\bR\s?\d[\d\s,.]*/;

export function readDraftSignals(message: string): DraftSignals {
  const text = message.trim();
  return {
    hasPrice: PRICE_PATTERN.test(text),
    hasDay: DAY_WORDS.test(text),
    hasCTA: CTA_WORDS.test(text),
    discountHeavy: DISCOUNT_WORDS.test(text),
    hasUrgency: URGENCY_WORDS.test(text),
    hasFood: FOOD_WORDS.test(text),
    tooShort: text.length < 60,
    tooLong: text.length > 320,
  };
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function segmentLabel(segment: PulseMapSegment): string {
  switch (segment) {
    case 'vip': return 'VIPs';
    case 'regular': return 'Regulars';
    case 'at_risk': return 'At-risk guests';
    case 'dormant': return 'Dormant guests';
    case 'new': return 'New customers';
  }
}

/** Per-segment rubric: base 46, plus signal bonuses/penalties. */
function segmentIntent(segment: PulseMapSegment, s: DraftSignals, summary: SegmentSummary): number {
  switch (segment) {
    case 'vip':
      return clamp(
        52 + (s.hasCTA ? 10 : 0) + (s.hasFood ? 12 : 0) + (s.hasPrice ? 4 : 0) +
          (s.discountHeavy ? -14 : 0) + (s.tooShort ? -6 : 0),
      );
    case 'regular':
      return clamp(
        50 + (s.hasPrice ? 14 : 0) + (s.hasDay ? 12 : 0) + (s.hasCTA ? 10 : 0) +
          (s.hasFood ? 6 : 0) + (s.tooShort ? -8 : 0),
      );
    case 'at_risk':
      return clamp(
        44 + (s.hasUrgency ? 14 : 0) + (s.hasPrice ? 10 : 0) + (s.discountHeavy ? 8 : 0) +
          (s.hasDay ? 6 : 0) + (s.hasCTA ? 6 : 0),
      );
    case 'dormant':
      // Dormant guests need the strongest reason: urgency + concrete value.
      return clamp(
        36 + (s.hasUrgency ? 16 : 0) + (s.hasPrice ? 12 : 0) + (s.discountHeavy ? 10 : 0) +
          (s.hasCTA ? 6 : 0) + (s.hasDay ? 4 : 0),
      );
    case 'new':
      return clamp(
        42 + (s.hasPrice ? 12 : 0) + (s.hasFood ? 10 : 0) + (s.hasCTA ? 8 : 0) +
          (s.tooLong ? -6 : 0) + (s.tooShort ? -6 : 0),
      );
  }
}

function segmentReaction(segment: PulseMapSegment, s: DraftSignals, intent: number, summary: SegmentSummary): string {
  const label = segmentLabel(segment);
  const n = summary.count;
  const people = n === 0 ? `no ${label.toLowerCase()} in this dataset yet` : `${n} ${label.toLowerCase()}`;
  const warmth = intent >= 70 ? 'Strong fit' : intent >= 50 ? 'Likely to respond' : intent >= 35 ? 'On the fence' : 'Likely to ignore';
  switch (segment) {
    case 'vip':
      if (s.discountHeavy) return `${warmth} (${people}), but the heavy discount language may read as mass-market — VIPs prefer to feel invited, not discounted.`;
      return `${warmth} (${people}) — an experience-framed offer lands well with your highest-value guests.`;
    case 'regular':
      return `${warmth} (${people}) — concrete price, a named day and a clear next step are exactly what regulars act on.`;
    case 'at_risk':
      return s.hasUrgency
        ? `${warmth} (${people}) — urgency gives lapsed guests a reason to book this week rather than someday.`
        : `${warmth} (${people}) — a dated reason-to-return would push this higher; at-risk guests drift without a deadline.`;
    case 'dormant':
      return s.hasUrgency && s.hasPrice
        ? `${warmth} (${people}) — dormant guests need a strong, dated incentive to break the silence.`
        : `${warmth} (${people}) — without a concrete dated incentive most dormant guests will scroll past.`;
    case 'new':
      return `${warmth} (${people}) — new customers need the value spelled out clearly before their first booking.`;
  }
}

function objectionsFor(s: DraftSignals, draft: SimulationContext['draft']): string[] {
  const out: string[] = [];
  if (!s.hasPrice) out.push('Price is unclear — guests will ask "how much?" before booking.');
  if (!s.hasDay) out.push('The offer has no clear date — guests cannot tell when it is valid.');
  if (s.discountHeavy) out.push('Reads like a discount blast rather than an invitation — your best guests may tune out.');
  if (!s.hasCTA) out.push('No single next step — guests do not know what to do with the message.');
  if (s.tooShort) out.push('The message is thin — the value of the offer is not landing in one read.');
  if (s.tooLong) out.push('The message is long for WhatsApp — key details get skimmed past.');
  if (!s.hasFood) out.push('No food or experience detail — the offer does not paint a picture.');
  if (out.length === 0) out.push('No major objections predicted — the offer is concrete and clear.');
  return out.slice(0, 6);
}

function repliesFor(s: DraftSignals): string[] {
  const out = [
    'Does this include drinks?',
    'Can we book for 4 at 7pm?',
  ];
  if (s.hasPrice) out.push('Is the price per person or per table?');
  else out.push('How much is it?');
  out.push('Is this available for takeaway?');
  out.push('Is the menu halaal / vegetarian-friendly?');
  if (s.hasDay) out.push('Is that date still available?');
  return out.slice(0, 6);
}

function riskFlagsFor(s: DraftSignals, summaries: SegmentSummary[]): string[] {
  const out: string[] = [];
  if (s.discountHeavy && (summaries.find((x) => x.segment === 'vip')?.count ?? 0) > 0) {
    out.push('Discount-heavy wording may cheapen the brand for your VIPs.');
  }
  if (!s.hasDay) out.push('No validity window — replies may arrive after the offer ends.');
  if (!s.hasCTA) out.push('Unclear call-to-action risks replies like "interested?" instead of bookings.');
  const reachable = summaries.reduce((a, b) => a + b.count, 0);
  if (reachable > 0 && reachable < 50) out.push('Small reachable audience — expect modest absolute numbers.');
  if (out.length === 0) out.push('No structural risks detected.');
  return out.slice(0, 4);
}

function improvedCopyFor(ctx: SimulationContext, s: DraftSignals): string {
  const name = ctx.restaurant.name || 'us';
  const price = ctx.draft.message.match(PRICE_PATTERN)?.[0]?.trim() ?? ctx.draft.offer;
  const day = ctx.draft.message.match(DAY_WORDS)?.[0] ?? (ctx.draft.sendAt ? new Date(ctx.draft.sendAt).toLocaleDateString('en-ZA', { weekday: 'long' }) : 'this week');
  const food = ctx.draft.message.match(FOOD_WORDS)?.[0] ?? 'a great table';
  const lines: string[] = [];
  lines.push(`${name} · ${day.charAt(0).toUpperCase() + day.slice(1)}`);
  if (price) lines.push(`${price} — per couple, menu included.`.replace('per couple', 'for two'));
  lines.push(`Join us for ${food} — a proper night out, made easy.`);
  lines.push(`Limited tables. Reply BOOK with your party size and we will confirm on WhatsApp.`);
  const copy = lines.filter(Boolean).join('\n');
  // If the original already carries every signal, the improvement is light:
  // tighten rather than rewrite (honesty: never invent a different offer).
  if (s.hasPrice && s.hasDay && s.hasCTA && !s.tooShort && !s.tooLong) {
    return `${ctx.draft.message.trim()}\n\n(Reply BOOK and we will confirm your table.)`;
  }
  return copy;
}

export function readinessFromScore(score: number): Readiness {
  if (score >= 72) return 'ready';
  if (score >= 50) return 'improve';
  return 'rework';
}

/**
 * The deterministic demo forecast. Pure function of context — same input,
 * same output, every run.
 */
export function generateDemoForecast(ctx: SimulationContext): Forecast {
  const s = readDraftSignals(ctx.draft.message);
  const reactions: SegmentReaction[] = ctx.segmentSummaries.map((summary) => {
    const intent = segmentIntent(summary.segment, s, summary);
    return {
      segment: summary.segment,
      reaction: segmentReaction(summary.segment, s, intent, summary),
      purchaseIntent: intent,
      primaryObjection: objectionsFor(s, ctx.draft)[0] ?? null,
    };
  });

  // Overall score: weighted toward the TARGET segment when one is chosen,
  // else weighted by audience size (a forecast for the people who get it).
  const target = ctx.draft.targetSegment;
  const weights = ctx.segmentSummaries.map((summary) => {
    if (target && summary.segment === target) return 3;
    return summary.count > 0 ? 1 : 0.25;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const weighted = reactions.reduce((acc, r, i) => acc + r.purchaseIntent * weights[i], 0);
  const score = clamp(weighted / totalWeight);

  const best = reactions.reduce<(typeof reactions)[number] | null>(
    (acc, r) => (acc === null || r.purchaseIntent > acc.purchaseIntent ? r : acc),
    null,
  );

  const reachable = ctx.segmentSummaries.reduce((a, b) => a + b.count, 0);
  const replyRate = 0.08 + (score / 100) * 0.22; // 8%–30% band, fixed rule
  const predictedReplies = Math.round(reachable * replyRate);

  const confidence: ConfidenceLevel = 'low'; // honest: demo, not live AI

  return {
    score,
    readiness: readinessFromScore(score),
    bestSegment: best?.segment ?? null,
    purchaseIntent: `About ${predictedReplies} of ${reachable.toLocaleString('en-US')} reachable guests expected to reply; roughly ${Math.round(predictedReplies * 0.6)} could turn into bookings if the message is kept concrete.`,
    objections: objectionsFor(s, ctx.draft),
    likelyReplies: repliesFor(s),
    riskFlags: riskFlagsFor(s, ctx.segmentSummaries),
    improvedCopy: improvedCopyFor(ctx, s),
    explanation:
      `DEMO FORECAST — fixed rules ran over your draft and the sample dataset's segment averages (${ctx.segmentSummaries
        .filter((x) => x.count > 0)
        .map((x) => `${x.count} ${segmentLabel(x.segment).toLowerCase()}`)
        .join(', ') || 'empty sample data'}). This demonstrates PulseMap on sample data; it is not a live AI prediction.`,
    confidence,
    assumptions: [
      'Demo Mode: the forecast uses the deadbeef sample dataset only — no live customer data.',
      'Fixed deterministic rules stand in for the AI model so demos never depend on provider availability.',
      'Reply-rate band is a fixed 8–30% rule of thumb, not a model estimate.',
      'Real results are measured after launch — this forecast does not promise customer behaviour.',
    ],
    segmentReactions: reactions,
  };
}
