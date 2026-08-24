import { createHash } from 'node:crypto';

export type RevenueOutcome = 'converted' | 'missed' | 'handled' | 'lost';
export type OutcomeClassifier = 'rule' | 'ai' | 'manual';
export type RevenueEventType = 'booking' | 'waitlist' | 'reactivation' | 'missed_enquiry';

export interface ConversationMessageSnapshot {
  direction: 'inbound' | 'outbound';
  content: string;
  createdAt: Date;
  isAIGenerated?: boolean;
}

export interface ConversionSnapshot {
  partySize: number | null;
  createdAt?: Date | null;
}

export interface ConversationSnapshot {
  id: string;
  tenantId: string;
  createdAt: Date;
  lastMessageAt: Date;
  messages: ConversationMessageSnapshot[];
  reservation?: ConversionSnapshot | null;
  waitlistEntry?: ConversionSnapshot | null;
  avgCheckCents?: number;
}

export interface ClassificationResult {
  outcome: RevenueOutcome;
  estimatedValueCents: number;
  classifier: OutcomeClassifier;
  reason: string;
  eventType?: RevenueEventType;
}

export interface AiClassificationResult {
  outcome: RevenueOutcome;
  estimatedValueCents?: number;
  reason?: string;
}

export type AiClassifier = (prompt: string) => Promise<AiClassificationResult | null>;

export interface ClassifyOptions {
  now?: Date;
  avgCheckCents?: number;
  silentHours?: number;
  aiClassifier?: AiClassifier;
}

const DEFAULT_AVG_CHECK_CENTS = 35_000;
const DEFAULT_SILENT_HOURS = 4;
const WAITLIST_CONFIDENCE = 0.5;
const LLM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const bookingIntent = /\b(book|booking|reservation|reserve|table|seat|dinner|lunch|brunch|tonight|tomorrow|party of|for \d+|for two|for three|for four|for five|for six|available|availability)\b/i;
const menuIntent = /\b(menu|food|drinks|specials|wine|cocktail|vegetarian|vegan|gluten|price|cost)\b/i;
const factualIntent = /\b(hour|hours|open|close|closing|location|address|where are you|directions|parking|phone number|contact)\b/i;
const followUpIntent = /\b(interested|please call|call me|quote|confirm|do you have space|can you fit|want to come|would like to|need a table|follow up|manager)\b/i;

const numberWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const aiCache = new Map<string, { expiresAt: number; result: AiClassificationResult | null }>();

function clampCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function estimate(avgCheckCents: number, partySize: number, multiplier = 1): number {
  return clampCents(avgCheckCents * Math.max(1, partySize) * multiplier);
}

export function inferPartySize(text: string): number {
  const explicit = text.match(/(?:party of|table for|for|x)\s*(\d{1,2})\b/i) || text.match(/\b(\d{1,2})\s*(?:people|pax|guests|persons)\b/i);
  if (explicit) return Math.min(20, Math.max(1, Number(explicit[1])));

  const lower = text.toLowerCase();
  for (const [word, value] of Object.entries(numberWords)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return value;
  }
  return 2;
}

function transcript(messages: ConversationMessageSnapshot[]): string {
  return messages
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((m) => `${m.direction.toUpperCase()}: ${m.content}`)
    .join('\n');
}

function lastMessage(messages: ConversationMessageSnapshot[]): ConversationMessageSnapshot | undefined {
  return messages.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

function hasOutboundAfter(messages: ConversationMessageSnapshot[], inbound: ConversationMessageSnapshot): boolean {
  return messages.some((m) => m.direction === 'outbound' && m.createdAt.getTime() > inbound.createdAt.getTime());
}

function lastInbound(messages: ConversationMessageSnapshot[]): ConversationMessageSnapshot | undefined {
  return messages
    .filter((m) => m.direction === 'inbound')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

function onlyFactualQa(text: string): boolean {
  return factualIntent.test(text) && !bookingIntent.test(text) && !menuIntent.test(text) && !followUpIntent.test(text);
}

function buildAiPrompt(snapshot: ConversationSnapshot): string {
  return `Classify this restaurant conversation outcome: CONVERTED, MISSED, HANDLED, or LOST. Return JSON.\n\nDefinitions:\n- CONVERTED: customer became a reservation or joined the waitlist.\n- MISSED: customer asked about booking/menu/revenue intent and their last message was unanswered for 4+ hours.\n- HANDLED: factual Q&A was answered or no conversion was expected.\n- LOST: customer expressed commercial interest but no follow-up happened.\n\nConversation ID: ${snapshot.id}\nTranscript:\n${transcript(snapshot.messages)}\n\nReturn exactly: {"outcome":"CONVERTED|MISSED|HANDLED|LOST","estimatedValueCents":0,"reason":"short reason"}`;
}

function cacheKey(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

async function classifyWithCache(prompt: string, classifier: AiClassifier): Promise<AiClassificationResult | null> {
  const key = cacheKey(prompt);
  const cached = aiCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.result;

  const result = await classifier(prompt);
  aiCache.set(key, { result, expiresAt: now + LLM_CACHE_TTL_MS });
  return result;
}

function normalizeOutcome(value: unknown): RevenueOutcome | null {
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase();
  if (v === 'converted' || v === 'missed' || v === 'handled' || v === 'lost') return v;
  return null;
}

export function parseAiClassification(raw: unknown): AiClassificationResult | null {
  if (!raw) return null;
  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const outcome = normalizeOutcome(record.outcome);
    if (!outcome) return null;
    return {
      outcome,
      estimatedValueCents: typeof record.estimatedValueCents === 'number' ? record.estimatedValueCents : undefined,
      reason: typeof record.reason === 'string' ? record.reason : undefined,
    };
  }
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return parseAiClassification(JSON.parse(cleaned));
  } catch {
    return null;
  }
}

export async function classifyConversation(
  snapshot: ConversationSnapshot,
  options: ClassifyOptions = {}
): Promise<ClassificationResult> {
  const now = options.now ?? new Date();
  const avgCheckCents = options.avgCheckCents ?? snapshot.avgCheckCents ?? DEFAULT_AVG_CHECK_CENTS;
  const silentMs = (options.silentHours ?? DEFAULT_SILENT_HOURS) * 60 * 60 * 1000;
  const text = transcript(snapshot.messages);
  const inferredPartySize = inferPartySize(text);

  if (snapshot.reservation) {
    const partySize = snapshot.reservation.partySize || inferredPartySize;
    return {
      outcome: 'converted',
      estimatedValueCents: estimate(avgCheckCents, partySize),
      classifier: 'rule',
      reason: 'Linked reservation found for conversation.',
      eventType: 'booking',
    };
  }

  if (snapshot.waitlistEntry) {
    const partySize = snapshot.waitlistEntry.partySize || inferredPartySize;
    return {
      outcome: 'converted',
      estimatedValueCents: estimate(avgCheckCents, partySize, WAITLIST_CONFIDENCE),
      classifier: 'rule',
      reason: 'Linked waitlist entry found for conversation.',
      eventType: 'waitlist',
    };
  }

  const latest = lastMessage(snapshot.messages);
  const latestInbound = lastInbound(snapshot.messages);
  const hasMessages = snapshot.messages.length > 0;
  const silenceMs = now.getTime() - snapshot.lastMessageAt.getTime();
  const isSilent = silenceMs >= silentMs;
  const hasBookingOrMenuIntent = bookingIntent.test(text) || menuIntent.test(text);

  if (latest && latest.direction === 'inbound' && isSilent && hasBookingOrMenuIntent) {
    return {
      outcome: 'missed',
      estimatedValueCents: estimate(avgCheckCents, inferredPartySize),
      classifier: 'rule',
      reason: 'Customer booking/menu intent was left unanswered for at least 4 hours.',
      eventType: 'missed_enquiry',
    };
  }

  if (hasMessages && onlyFactualQa(text)) {
    return {
      outcome: 'handled',
      estimatedValueCents: 0,
      classifier: 'rule',
      reason: 'Conversation only contains factual hours/location style Q&A.',
    };
  }

  if (latestInbound && isSilent && followUpIntent.test(latestInbound.content) && !hasOutboundAfter(snapshot.messages, latestInbound)) {
    return {
      outcome: 'lost',
      estimatedValueCents: estimate(avgCheckCents, inferredPartySize),
      classifier: 'rule',
      reason: 'Customer expressed commercial interest but no follow-up was sent.',
    };
  }

  if (options.aiClassifier) {
    const prompt = buildAiPrompt(snapshot);
    const aiResult = await classifyWithCache(prompt, options.aiClassifier);
    const outcome = normalizeOutcome(aiResult?.outcome);
    if (outcome) {
      return {
        outcome,
        estimatedValueCents: clampCents(aiResult?.estimatedValueCents ?? (outcome === 'handled' ? 0 : estimate(avgCheckCents, inferredPartySize))),
        classifier: 'ai',
        reason: aiResult?.reason || 'AI classifier resolved ambiguous conversation.',
        eventType: outcome === 'missed' ? 'missed_enquiry' : undefined,
      };
    }
  }

  return {
    outcome: 'handled',
    estimatedValueCents: 0,
    classifier: 'rule',
    reason: 'No conversion or missed-enquiry signal detected.',
  };
}

export async function classifyWithGroqGemini(prompt: string): Promise<AiClassificationResult | null> {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;

  if (groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          messages: [
            { role: 'system', content: 'You classify restaurant WhatsApp conversations. Return JSON only.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0,
          max_tokens: 180,
          response_format: { type: 'json_object' },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        const parsed = parseAiClassification(content);
        if (parsed) return parsed;
      }
    } catch (err) {
      console.error('[revenue/classify] Groq classifier failed', err);
    }
  }

  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 180, responseMimeType: 'application/json' },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = parseAiClassification(content);
        if (parsed) return parsed;
      }
    } catch (err) {
      console.error('[revenue/classify] Gemini classifier failed', err);
    }
  }

  return null;
}
