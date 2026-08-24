import crypto from 'node:crypto';

/**
 * Gate #12 — Review response drafting, framework-free.
 *
 * The templates are deliberately deterministic and rule-first: an owner
 * must be able to trust that pressing "Regenerate" without an LLM key
 * configured still produces a professional, correct, on-brand draft. The
 * LLM is only ever an ENRICHER — it extracts themes (food / service /
 * ambiance) from complex review text to personalize the opening line, and
 * every LLM failure degrades silently back to the rule-based draft.
 *
 * Nothing here sends anything. Drafts are stored on the review row and
 * shown to the owner, who edits, approves and posts them to Google.
 */

export interface ReviewForResponse {
  authorName: string;
  rating: number;
  text: string | null;
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface ResponseContext {
  /** Shown to negative reviewers as the make-it-right channel. */
  contactEmail?: string | null;
  contactPhone?: string | null;
}

// -----------------------------------------------------------------------------
// Specifics extraction (dishes / staff / ambiance) — pure rules
// -----------------------------------------------------------------------------

/**
 * SA-restaurant-flavoured lexicon. Word-boundary matching so "curry" does
 * not match "currywurst..." false friends like "steakhouse" matching
 * "steak" is harmless (both are beef-forward signals); "pie" NOT matching
 * "spaghetti" is why each entry is regex-anchored.
 */
const DISH_LEXICON = [
  'pizza', 'burger(s)?', 'steak', 'rib(s)?', 'pasta', 'sushi', 'wing(s)?',
  'curry', 'bunny chow', 'tramezzino(s)?', 'braai(bb)?[cq]ue', 'koeksister(s)?',
  'biltong', 'boerewors', 'pap', 'sosatie(s)?', 'seafood', 'prawn(s)?', 'hake',
  'calamari', 'salad', 'dessert(s)?', 'cheesecake', 'malva', 'coffee', 'cocktail(s)?',
  'breakfast', 'brunch', 'lunch', 'platter(s)?', 'tapas', 'nachos', 'taco(s)?',
  'shawarma', 'falafel', 'ramen', 'pho', 'paella', 'risotto', 'gnocchi', 'lasagne',
];

const STAFF_LEXICON = ['waiter(s)?', 'waitress(es)?', 'manager', 'chef', 'host(ess)?', 'bartender', 'server', 'team', 'service'];

const AMBIANCE_LEXICON = [
  'vibe', 'atmosphere', 'ambiance', 'ambience', 'decor', 'interior', 'view(s)?',
  'music', 'playlist', 'garden', 'patio', 'terrace', 'seating', 'lighting', 'sunset',
];

export interface ReviewSpecifics {
  dishes: string[];
  staff: string[];
  ambiance: string[];
}

function matchLexicon(text: string, lexicon: string[]): string[] {
  const found = new Set<string>();
  for (const entry of lexicon) {
    const pattern = new RegExp(`\\b(${entry})\\b`, 'i');
    const match = text.match(pattern);
    if (match) found.add(match[0].toLowerCase());
  }
  return Array.from(found);
}

/** Extract mentioned dishes/staff/ambiance words from review text. */
export function extractSpecifics(text: string | null | undefined): ReviewSpecifics {
  if (!text) return { dishes: [], staff: [], ambiance: [] };
  return {
    dishes: matchLexicon(text, DISH_LEXICON),
    staff: matchLexicon(text, STAFF_LEXICON),
    ambiance: matchLexicon(text, AMBIANCE_LEXICON),
  };
}

/** Human phrase for the first specific thing worth referencing, if any. */
export function firstSpecific(specifics: ReviewSpecifics): string | null {
  if (specifics.dishes.length > 0) return `our ${specifics.dishes[0]}`;
  if (specifics.ambiance.length > 0) return `the ${specifics.ambiance[0]}`;
  if (specifics.staff.length > 0) return `our ${specifics.staff[0]}`;
  return null;
}

// -----------------------------------------------------------------------------
// Rule-based templates (the always-available path)
// -----------------------------------------------------------------------------

/**
 * The deterministic draft. Sentiment decides the template; the first
 * specific mention personalizes it. Negative reviews always get a direct
 * contact channel (phone preferred, email fallback).
 */
export function generateResponse(review: ReviewForResponse, context: ResponseContext = {}): string {
  const author = review.authorName?.trim() || 'there';
  const specifics = extractSpecifics(review.text);
  const specific = firstSpecific(specifics);

  if (review.sentiment === 'positive') {
    const enjoyed = specific ? ` We're thrilled you enjoyed ${specific}` : " We're thrilled you enjoyed your visit";
    return `Thank you so much, ${author}!${enjoyed}. We look forward to welcoming you back soon!`;
  }

  if (review.sentiment === 'neutral') {
    const focus = specific ? ` — especially ${specific}` : '';
    return `Thank you for your feedback, ${author}. We appreciate you taking the time to share your experience${focus}. We're always looking to improve and hope to serve you better next time.`;
  }

  // Negative.
  const channel = context.contactPhone
    ? `at ${context.contactPhone}`
    : context.contactEmail
      ? `at ${context.contactEmail}`
      : 'directly';
  return `We're sorry to hear about your experience, ${author}. This isn't the standard we strive for. Please reach out to us directly ${channel} so we can make it right.`;
}

// -----------------------------------------------------------------------------
// LLM theme extraction (Groq -> Gemini fallback, mirroring lib/revenue/classify.ts)
// -----------------------------------------------------------------------------

export type Theme = 'food' | 'service' | 'ambiance' | 'value' | 'cleanliness';
export type ThemeClassifier = (reviewText: string) => Promise<Theme[] | null>;

const VALID_THEMES: Theme[] = ['food', 'service', 'ambiance', 'value', 'cleanliness'];

/** Parse an LLM JSON reply into a themes array; null when unusable. */
export function parseThemesReply(content: unknown): Theme[] | null {
  let parsed: unknown;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
  } else {
    parsed = content;
  }
  const themes = (parsed as { themes?: unknown } | null)?.themes;
  if (!Array.isArray(themes)) return null;
  const valid = themes.filter(
    (theme): theme is Theme => typeof theme === 'string' && (VALID_THEMES as string[]).includes(theme)
  );
  return valid.length > 0 ? valid : null;
}

/**
 * Groq-first, Gemini-fallback theme extraction — the same fallback chain
 * and model choices as the revenue classifier so one provider outage never
 * blocks drafting. Returns null (never throws) so the caller degrades to
 * the rule-based draft.
 */
export async function classifyThemesWithGroqGemini(reviewText: string): Promise<Theme[] | null> {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!groqKey && !geminiKey) return null;

  const prompt =
    `Extract the key themes this restaurant reviewer talks about. ` +
    `Reply with JSON only: {"themes": [...]} using any of food, service, ambiance, value, cleanliness.\n\n` +
    `Review: "${reviewText.slice(0, 1500)}"`;

  if (groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          messages: [
            { role: 'system', content: 'You classify restaurant review text. Return JSON only.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0,
          max_tokens: 80,
          response_format: { type: 'json_object' },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const themes = parseThemesReply(data.choices?.[0]?.message?.content);
        if (themes) return themes;
      }
    } catch (err) {
      console.error('[reputation/response-generator] Groq theme classifier failed', err);
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
            generationConfig: { temperature: 0, maxOutputTokens: 80 },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const themes = parseThemesReply(text);
        if (themes) return themes;
      }
    } catch (err) {
      console.error('[reputation/response-generator] Gemini theme classifier failed', err);
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// 24h theme cache — keyed by review text hash, TTL injected for tests
// -----------------------------------------------------------------------------

const THEME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ThemeCacheEntry {
  themes: Theme[] | null;
  expiresAt: number;
}

export interface ThemeCache {
  get(key: string, now: Date): Theme[] | null | undefined;
  set(key: string, themes: Theme[] | null, now: Date): void;
}

export function createThemeCache(ttlMs: number = THEME_CACHE_TTL_MS): ThemeCache {
  const store = new Map<string, ThemeCacheEntry>();
  return {
    get(key, now) {
      const entry = store.get(key);
      if (!entry) return undefined; // cache miss
      if (entry.expiresAt <= now.getTime()) {
        store.delete(key);
        return undefined; // expired == miss
      }
      return entry.themes;
    },
    set(key, themes, now) {
      store.set(key, { themes, expiresAt: now.getTime() + ttlMs });
    },
  };
}

/** Process-wide default cache (classification is per-review-text, stable 24h). */
const defaultThemeCache = createThemeCache();

export function themeCacheKey(reviewText: string): string {
  return crypto.createHash('sha256').update(reviewText).digest('hex');
}

// -----------------------------------------------------------------------------
// The draft pipeline: rules first, LLM enrichment second, owner always last
// -----------------------------------------------------------------------------

export interface DraftOptions {
  classifier?: ThemeClassifier;
  cache?: ThemeCache;
  now?: Date;
}

/**
 * Themes worth surfacing: rule-extracted specifics when present, otherwise
 * a cached (24h) LLM classification of the review text.
 */
async function resolveThemes(
  review: ReviewForResponse,
  options: DraftOptions
): Promise<Theme[] | null> {
  const specifics = extractSpecifics(review.text);
  const ruleThemes: Theme[] = [];
  if (specifics.dishes.length > 0) ruleThemes.push('food');
  if (specifics.staff.length > 0) ruleThemes.push('service');
  if (specifics.ambiance.length > 0) ruleThemes.push('ambiance');
  if (ruleThemes.length > 0) return ruleThemes;

  if (!review.text || review.text.length < 40) return null; // too little signal

  const classifier = options.classifier;
  if (!classifier) return null;

  const now = options.now ?? new Date();
  const cache = options.cache ?? defaultThemeCache;
  const key = themeCacheKey(review.text);
  const cached = cache.get(key, now);
  if (cached !== undefined) return cached;

  const themes = await classifier(review.text); // may be null on failure
  cache.set(key, themes, now);
  return themes;
}

function themeSentence(themes: Theme[]): string {
  const names: Record<Theme, string> = {
    food: 'the food',
    service: 'the service',
    ambiance: 'the ambiance',
    value: 'the value for money',
    cleanliness: 'the cleanliness',
  };
  const joined = themes.map((theme) => names[theme]).join(' and ');
  return `Thank you for your detailed feedback about ${joined}`;
}

/**
 * Produce the response draft for a review. Deterministic template always;
 * when themes are available the draft acknowledges them explicitly. The
 * LLM path only ever runs through the cache, so re-drafting the same review
 * within 24h costs zero provider calls.
 */
export async function draftReviewResponse(
  review: ReviewForResponse,
  context: ResponseContext = {},
  options: DraftOptions = {}
): Promise<string> {
  const base = generateResponse(review, context);
  const themes = await resolveThemes(review, options);
  if (!themes || themes.length === 0) return base;

  const author = review.authorName?.trim() || 'there';
  const acknowledgment = ` Thank you for ${themeSentence(themes)}${themes.length > 1 ? ' — we take both seriously' : ''}.`;

  if (review.sentiment === 'positive') {
    return base.replace(/ We look forward/, `${acknowledgment} We look forward`);
  }
  return `${base}${acknowledgment}`;
}
