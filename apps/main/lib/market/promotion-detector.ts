/**
 * Gate #16 — promotion detector, framework-free.
 *
 * Scans a website's text for promotion keywords ("special", "discount",
 * "happy hour", "2-for-1", …) and extracts the surrounding sentence as the
 * promotion text. The sentence — not the keyword — is the alert's content:
 * "happy hour" alone tells the owner nothing, "Happy hour weekdays 16:00-18:00,
 * half-price cocktails" does.
 *
 * `promotionKey()` normalizes a sentence into a dedup fingerprint so the
 * daily cron can tell a NEW blurb from yesterday's same blurb.
 */

export interface DetectedPromotion {
  promotionText: string;
  promotionKey: string;
  /** Keyword family that matched (for metrics). */
  keyword: string;
}

/** Keyword families; alternation handles the common spellings. */
const PROMOTION_KEYWORDS = [
  'special(s)?',
  'discount(s)?',
  'happy hour',
  '2[\\s-]?for[\\s-]?1',
  'two[\\s-]?for[\\s-]?one',
  'buy one get one',
  'bogof',
  'half[\\s-]?price',
  '50%\\s?off',
  '\\d{1,2}%\\s?off',
  'combo deal',
  'meal deal',
  'voucher(s)?',
  'coupon(s)?',
  'free starter',
  'free dessert',
  'kids eat free',
  'lunch special',
  'sunset special',
];

const KEYWORD_PATTERN = new RegExp(`\\b(${PROMOTION_KEYWORDS.join('|')})\\b`, 'i');

/**
 * Split text into sentences (newline or sentence punctuation), trimming
 * aggressively. A "sentence" may span a line break mid-thought only rarely
 * on menus; keeping line-based segmentation is the conservative choice.
 */
function sentences(text: string): string[] {
  return text
    .split(/\n|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.replace(/\s{2,}/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/**
 * Normalize a promotion sentence into a dedup key: lowercase, strip
 * punctuation/digits-boundary noise, collapse whitespace. Two days of the
 * same banner produce the same key; any rewording produces a new one.
 */
export function promotionKey(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Pure text -> promotions (testable without any transport). */
export function detectPromotionsInText(text: string): DetectedPromotion[] {
  const found = new Map<string, DetectedPromotion>();
  for (const sentence of sentences(text)) {
    if (sentence.length > 220) continue; // paragraphs are not promotions
    const match = sentence.match(KEYWORD_PATTERN);
    if (!match) continue;
    const key = promotionKey(sentence);
    if (!key || found.has(key)) continue;
    found.set(key, { promotionText: sentence, promotionKey: key, keyword: match[0].toLowerCase() });
  }
  return Array.from(found.values());
}

export async function detectPromotions(
  websiteUrl: string,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<DetectedPromotion[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(websiteUrl, {
    headers: { 'User-Agent': 'GeminoMarketBot/1.0 (+promotion tracking)' },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Fetch ${websiteUrl} failed: ${res.status}`);
  }
  const body = await res.text();
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ');
  return detectPromotionsInText(text);
}
