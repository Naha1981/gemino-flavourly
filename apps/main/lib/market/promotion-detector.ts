/**
 * Gate #16 — competitor promotion detection, framework-free.
 *
 * Scans a competitor's public website for offer language ("happy hour",
 * "2-for-1", "20% off", "lunch special") and returns what it found, with the
 * surrounding text so a human can judge it.
 *
 * Two classes of keyword, deliberately:
 *
 *   - STRONG phrases are specific enough to stand alone ("kids eat free",
 *     "buy one get one free", "25% off").
 *   - WEAK words are ambiguous in isolation — "special" is on every menu that
 *     has a chef's special, and "deal" appears in "deal with dietary
 *     requirements". A weak word only counts when its own line also carries a
 *     supporting signal: a price, a percentage, "off", "save", "only",
 *     "limited", etc.
 *
 * That trade is what keeps the alert stream credible: a false "competitor
 * launched a promotion" alert trains the owner to ignore every later one.
 */

import { fetchPageText, htmlToText, isSafePublicUrl, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES } from './menu-scraper.ts';

export interface DetectedPromotion {
  /** The offer text itself, trimmed to a readable length. */
  promotionText: string;
  /** The keyword that matched ("happy hour", "% off", …). */
  keyword: string;
  /** Where it was detected: "website:example.com". */
  source: string | null;
  /** The matched line plus its neighbours, for context in the dashboard. */
  context: string;
}

export interface PromotionKeyword {
  /** Human-readable label used in alerts and stored with the detection. */
  keyword: string;
  pattern: RegExp;
  /** Strong phrases need no supporting signal. */
  strong: boolean;
}

/**
 * A weak keyword needs one of these in the same line to count. Deliberately
 * concrete: "50% off", "R99", "save R20", "only R99", "limited time".
 */
export const SUPPORT_SIGNAL =
  /(?:[R$£€]\s?\d|\d+(?:\.\d+)?\s?%|\bhalf[- ]price\b|\bsave\b|\bonly\b|\bfree\b|\boff\b|\bper person\b|\bnow\b|\btoday\b|\btonight\b|\bthis week\b|\bweekend\b|\blimited\b|\bwhile stocks\b)/i;

export const PROMOTION_KEYWORDS: PromotionKeyword[] = [
  // ── strong: unambiguous offer language ───────────────────────────────────
  { keyword: 'happy hour', pattern: /\bhappy\s*hours?\b/i, strong: true },
  { keyword: '2-for-1', pattern: /\b2\s*[-–]?\s*(?:for|4)\s*[-–]?\s*1\b/i, strong: true },
  { keyword: 'two-for-one', pattern: /\btwo\s+for\s+(?:the price of\s+)?one\b/i, strong: true },
  { keyword: 'buy one get one', pattern: /\bbuy\s+one[,\s]+get\s+one(?:\s+free)?\b/i, strong: true },
  { keyword: 'BOGO', pattern: /\bbogo\b/i, strong: true },
  { keyword: 'kids eat free', pattern: /\bkids\s+(?:eat|dine)\s+free\b/i, strong: true },
  { keyword: '% off', pattern: /\b\d{1,3}(?:\.\d+)?\s?%\s*off\b/i, strong: true },
  { keyword: 'half price', pattern: /\bhalf[- ]price\b/i, strong: true },
  { keyword: 'early bird', pattern: /\bearly\s*bird\b/i, strong: true },
  { keyword: 'all you can eat', pattern: /\ball\s+you\s+can\s+eat\b/i, strong: true },
  { keyword: 'freebie', pattern: /\bfree\s+(?:drink|dessert|coffee|starter|meal|delivery|bottle|glass|portion|side|entry|tasting|platter)\b/i, strong: true },
  { keyword: 'combo', pattern: /\bcombo(s)?\b/i, strong: true },
  { keyword: 'prix fixe', pattern: /\bprix\s+fixe\b|\bset\s+menu\b|\btable\s+d'h[oô]te\b/i, strong: true },

  // ── weak: only count with a price / percentage / urgency on the same line ─
  { keyword: 'special', pattern: /\bspecials?\b/i, strong: false },
  { keyword: 'discount', pattern: /\bdiscount(?:s|ed)?\b/i, strong: false },
  { keyword: 'deal', pattern: /\bdeals?\b/i, strong: false },
  { keyword: 'promotion', pattern: /\bpromo(?:tion|tional)?\b/i, strong: false },
  { keyword: 'offer', pattern: /\boffers?\b/i, strong: false },
  { keyword: 'sale', pattern: /\bsale\b/i, strong: false },
];

/** Longest stored/alerted promotion text. */
export const MAX_PROMOTION_CHARS = 240;
/** Ceiling per scan — a keyword-stuffed page must not bury the real offers. */
export const MAX_PROMOTIONS_PER_SCAN = 20;
/** Lines longer than this are split into sentences before scanning. */
const LONG_LINE = 220;

export interface DetectOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  maxPromotions?: number;
}

/**
 * Normalized identity of a promotion, used to avoid re-alerting on the same
 * banner every day: lower-cased, punctuation-blind, whitespace-collapsed.
 */
export function normalizePromotion(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split an over-long line into sentences so one keyword gets one promotion. */
function splitSentences(line: string): string[] {
  if (line.length <= LONG_LINE) return [line];
  return line
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Find promotions in already-extracted text.
 *
 * One detection per line: a line that matches three keywords is still one
 * offer, and reporting it three times would triple-count the alert.
 */
export function detectPromotionsInText(
  text: string,
  options: { maxPromotions?: number } = {}
): Array<Omit<DetectedPromotion, 'source'>> {
  const limit = options.maxPromotions ?? MAX_PROMOTIONS_PER_SCAN;
  const lines = text.split('\n').map((line) => line.trim());

  const found: Array<Omit<DetectedPromotion, 'source'>> = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    if (found.length >= limit) break;
    const line = lines[i];
    if (!line || line.length < 6) continue;

    for (const sentence of splitSentences(line)) {
      if (sentence.length < 6) continue;

      for (const entry of PROMOTION_KEYWORDS) {
        if (!entry.pattern.test(sentence)) continue;
        if (!entry.strong && !SUPPORT_SIGNAL.test(sentence)) continue;

        const promotionText = sentence.slice(0, MAX_PROMOTION_CHARS).trim();
        const key = normalizePromotion(promotionText);
        if (!key || seen.has(key)) break; // same offer as an earlier line
        seen.add(key);

        const neighbours = lines.slice(Math.max(0, i - 1), i + 2).filter(Boolean).join(' | ');
        found.push({
          promotionText,
          keyword: entry.keyword,
          context: neighbours.slice(0, 400),
        });
        break; // one detection per line
      }
    }
  }
  return found;
}

/** The "website:host" source label stored on every website detection. */
export function websiteSource(url: string): string | null {
  try {
    return `website:${new URL(url).hostname}`;
  } catch {
    return null;
  }
}

/**
 * Scan a competitor's website for promotions.
 *
 * Returns [] when the page has no offer language; throws on a fetch failure
 * or a non-public URL, so the tracking cron can count "nothing found" and
 * "could not check" separately.
 */
export async function detectPromotions(
  websiteUrl: string,
  options: DetectOptions = {}
): Promise<DetectedPromotion[]> {
  if (!isSafePublicUrl(websiteUrl)) {
    throw new Error(`Refusing to scan ${websiteUrl}: not a public http(s) URL`);
  }

  const { text } = await fetchPageText(websiteUrl, options, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.maxBytes ?? DEFAULT_MAX_BYTES);
  const source = websiteSource(websiteUrl);

  return detectPromotionsInText(htmlToText(text)).map((promotion) => ({ ...promotion, source }));
}

/**
 * Which detections are NEW relative to what is already stored. The cron uses
 * this to keep a three-week banner from becoming 21 alerts.
 */
export function newPromotions(
  detected: DetectedPromotion[],
  alreadyStored: Array<{ promotionText: string }>
): DetectedPromotion[] {
  const known = new Set(alreadyStored.map((row) => normalizePromotion(row.promotionText)));
  return detected.filter((promotion) => !known.has(normalizePromotion(promotion.promotionText)));
}
