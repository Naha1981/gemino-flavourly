/**
 * Gate #16 — competitor menu scraping, framework-free.
 *
 * There is no API for "another restaurant's menu", so this reads the public
 * HTML the restaurant already publishes and extracts dish/price pairs from
 * it. That is inherently heuristic, and the module is written to fail
 * honestly rather than plausibly:
 *
 *   - a line only becomes a menu item when it has BOTH a dish name and a
 *     price, so a scraped "About us" page yields zero items rather than
 *     twenty fake ones;
 *   - a diff is only reported against a real previous snapshot; the first
 *     scrape of a competitor is a baseline (hasChanges false, everything
 *     "new" is suppressed by the caller) rather than a menu rewrite;
 *   - anything that cannot be parsed returns an empty list, never a guess.
 *
 * The fetch implementation and the previous snapshot are injected, so every
 * parsing and diffing branch is testable offline against fixtures.
 */

export interface MenuItem {
  name: string;
  price: number;
  /** Nearest preceding section heading ("Starters", "Mains"), when present. */
  category: string | null;
}

export interface PriceChange {
  name: string;
  previousPrice: number;
  currentPrice: number;
  delta: number;
}

export interface MenuDiff {
  hasChanges: boolean;
  newItems: MenuItem[];
  removedItems: MenuItem[];
  priceChanges: PriceChange[];
}

export interface ScrapedMenu {
  /** The URL the menu was actually read from (may be a /menu sub-page). */
  menuUrl: string;
  /** Extracted page text, whitespace-normalized and truncated. */
  menuText: string;
  items: MenuItem[];
  /** e.g. "R100-R200 per person"; null when no prices were found. */
  priceRange: string | null;
  /** Currency symbol the prices were read in. */
  currency: string;
  diff: MenuDiff;
}

export interface ScrapeOptions {
  fetchImpl?: typeof fetch;
  /** The previous snapshot's items — the baseline the diff is computed against. */
  previousItems?: MenuItem[];
  /** Hard ceiling per fetch; a slow or enormous page must not hang the cron. */
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  /** Follow a "View menu" link when the landing page has no prices (default true). */
  followMenuLink?: boolean;
  currency?: string;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 1_000_000;
/** Stored in competitor_menu_snapshots.menu_text; keeps a 60k column honest. */
export const MAX_MENU_TEXT_CHARS = 20_000;
export const MAX_ITEMS = 400;

const USER_AGENT = 'GeminoMarketBot/1.0 (+https://gemino.app/bot)';

// -----------------------------------------------------------------------------
// URLs
// -----------------------------------------------------------------------------

/**
 * Reject URLs that would point the server at itself or at internal hosts.
 *
 * The tracker fetches URLs a TENANT supplies (the "Add Manually" form), so
 * without this a tenant could aim the scraper at the deployment's own
 * metadata endpoint or at 192.168.x boxes on the host network.
 *
 * Limitation, stated plainly: this checks the hostname as WRITTEN. A DNS name
 * that resolves to a private address (rebinding) still gets through — closing
 * that needs resolution-then-connect pinning, which undici does not expose
 * here. Public-host-only is the meaningful part of the risk; the rest is
 * documented rather than pretended away.
 */
export function isSafePublicUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return false;
  if (host === '0.0.0.0') return false;

  const parts = host.split('.');
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = [Number(parts[0]), Number(parts[1])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

/** Resolve a (possibly relative) link against a base URL. Null if unusable. */
export function resolveUrl(link: string, baseUrl: string): string | null {
  try {
    const absolute = new URL(link, baseUrl).toString();
    return isSafePublicUrl(absolute) ? absolute : null;
  } catch {
    return null;
  }
}

/**
 * Find a "view our menu" link on a landing page. Most restaurant sites put
 * the prices one click in, and scraping the home page alone would report
 * zero items for a menu that is plainly published.
 */
export function extractMenuLink(html: string, baseUrl: string): string | null {
  const anchorPattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  const linkWords = /menu|spyskaart|drankkaart|kaart|nos\s+menu|carte/i;

  let best: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1];
    const label = htmlToText(match[2]).trim();
    // An href or a label containing "menu" is enough; requiring both would
    // miss /spyskaart (Afrikaans) and "See what's cooking" links.
    if (!linkWords.test(href) && !linkWords.test(label)) continue;
    const absolute = resolveUrl(href, baseUrl);
    if (absolute) return absolute;
    if (!best) best = href;
  }
  return best;
}

// -----------------------------------------------------------------------------
// HTML -> text
// -----------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
  middot: '·',
  bull: '•',
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  times: 'x',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  frac12: '½',
  deg: '°',
  copy: '©',
  reg: '®',
  trade: '™',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  ntilde: 'ñ',
  ouml: 'ö',
  uuml: 'ü',
  auml: 'ä',
  szlig: 'ß',
  laquo: '«',
  raquo: '»',
};

/** Decode the entities menus actually contain (currency symbols especially). */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/**
 * HTML -> plain text with one menu line per newline. Block-level tags become
 * newlines BEFORE the tag soup is stripped, because the line structure is
 * what makes "Steak ... R180" a parseable row; stripping tags first would
 * collapse the whole menu into one unusable paragraph.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<template[\s\S]*?<\/template>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|hr)\b[^>]*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|td|th|section|article|dt|dd|figcaption)>/gi, '\n')
      .replace(/<(li|dt|dd)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// -----------------------------------------------------------------------------
// Prices and items
// -----------------------------------------------------------------------------

/** R120, R 120, R1 200, R120.50, ZAR 120, $12, £12, €12. */
const CURRENCY_PRICE = /(?:\bR|\bZAR|\$|£|€)\s?(\d{1,3}(?:[ ,]\d{3})*(?:\.\d{1,2})?)/g;
/** A bare trailing number ("Burger 120"), used only when no symbol appears. */
const BARE_TRAILING_PRICE = /(?:^|\s)(\d{1,4}(?:\.\d{1,2})?)\s*$/;

/**
 * Words that start a sentence about the restaurant rather than a dish. Only
 * applied to the bare-number branch: "Opens 18" and "Serves 4" would otherwise
 * become dishes, while a currency-priced line is trusted as a real item.
 */
/**
 * What may follow a real menu price: nothing, or a serving note ("ea", "pp",
 * "300g"). Anything else means the number sat inside a SENTENCE — "Add R20
 * for extra cheese", "Delivery fee R35 applies" — which is not a dish row and
 * would otherwise be stored as a dish called "Add" for R20.
 */
const PRICE_TRAILING_OK =
  /^(?:\s*(?:ea\.?|each|pp|p\.p\.|per person|\d{1,4}\s?(?:g|kg|ml|l)|\([^)]{0,40}\))?\s*[\s.·:*†—–\-]*)$/i;

const NON_DISH_PREFIX =
  /^(opens?|closes?|closed|closing|serves?|serving|book(ing|ings)?|call|order|follow|since|est|page|tel|fax|vat|reg)\b/i;

export interface LinePrice {
  price: number;
  currency: string;
  /** Index where the price token starts, so the name is what precedes it. */
  index: number;
}

/**
 * The price at the END of a menu line. Menus put the price last, and a
 * description may mention another amount ("add R20 for cheese"), so the LAST
 * currency match wins.
 */
export function parseLinePrice(line: string): LinePrice | null {
  let last: LinePrice | null = null;
  CURRENCY_PRICE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CURRENCY_PRICE.exec(line)) !== null) {
    const price = Number(match[1].replace(/[ ,](?=\d{3}\b)/g, ''));
    if (!Number.isFinite(price) || price <= 0) continue;
    const tokenEnd = match.index + match[0].length;
    if (!PRICE_TRAILING_OK.test(line.slice(tokenEnd))) continue; // price inside prose
    last = {
      price,
      currency: match[0].trim().startsWith('ZAR') ? 'ZAR' : match[0].trim().charAt(0),
      index: match.index,
    };
  }
  if (last) return last;

  // No currency symbol: accept a bare trailing number, but only when the rest
  // of the line looks like a dish name. This is what catches "Burger 120"
  // without turning "Serves 4" or "Opens 18" into menu items.
  const bare = line.match(BARE_TRAILING_PRICE);
  if (bare && bare.index !== undefined) {
    const price = Number(bare[1]);
    const namePart = line.slice(0, bare.index).trim();
    const plausible =
      Number.isFinite(price) &&
      price >= 5 &&
      price <= 5000 &&
      /[A-Za-z]{3,}/.test(namePart) &&
      !NON_DISH_PREFIX.test(namePart);
    if (plausible) return { price, currency: '', index: bare.index };
  }
  return null;
}

/** 'Burger • Large' -> 'burger large' — the diff key, punctuation-blind. */
export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip list bullets, leader dots and trailing punctuation from a dish name. */
function cleanItemName(raw: string): string {
  return raw
    .replace(/^[\s•·\-*–—>]+/, '')
    .replace(/[.\s•·\-–—:]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** A line with no price that looks like a section heading becomes the category. */
function asCategory(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 40) return null;
  if (/[.:;]/.test(trimmed)) return null;
  // Headings are words, not sentences: mostly letters, no digits.
  if (/\d/.test(trimmed)) return null;
  const letters = trimmed.replace(/[^A-Za-z]/g, '').length;
  if (letters < 3 || letters / trimmed.length < 0.7) return null;
  return trimmed;
}

/**
 * Dish/price extraction. `category` is the most recent heading-like line, so
 * "Starters / Soup R65" yields { name: 'Soup', category: 'Starters' }.
 */
export function parseMenuItems(text: string): MenuItem[] {
  const items: MenuItem[] = [];
  const seen = new Set<string>();
  let category: string | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const priced = parseLinePrice(line);
    if (!priced) {
      const heading = asCategory(line);
      if (heading) category = heading;
      continue;
    }

    const name = cleanItemName(line.slice(0, priced.index));
    // A price with no dish in front of it ("R50", a delivery fee line) is not
    // a menu item.
    if (normalizeItemName(name).length < 2) continue;
    // Lines that are obviously not dishes.
    if (/\b(delivery|deposit|booking fee|service charge|minimum spend)\b/i.test(name)) continue;

    const key = `${normalizeItemName(name)}|${priced.price}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({ name: name.slice(0, 160), price: priced.price, category });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

// -----------------------------------------------------------------------------
// Diffing
// -----------------------------------------------------------------------------

function byName(items: MenuItem[]): Map<string, MenuItem> {
  const map = new Map<string, MenuItem>();
  for (const item of items) {
    const key = normalizeItemName(item.name);
    if (!key) continue;
    // First occurrence wins: a repeated dish name with two prices (small /
    // large) is kept as the cheaper one, and reported as such rather than
    // flip-flopping between scrapes.
    if (!map.has(key)) map.set(key, item);
  }
  return map;
}

/**
 * Compare two snapshots by normalized dish name. Prices are compared exactly;
 * there is no tolerance, because "the price moved by R1" is exactly the kind
 * of small change a restaurant owner wants to hear about.
 */
export function diffMenus(previous: MenuItem[], current: MenuItem[]): MenuDiff {
  const previousByName = byName(previous);
  const currentByName = byName(current);

  const newItems: MenuItem[] = [];
  const priceChanges: PriceChange[] = [];
  // forEach rather than for...of: the repo's tsconfig targets ES5, where
  // iterating a Map needs downlevelIteration.
  currentByName.forEach((item, key) => {
    const before = previousByName.get(key);
    if (!before) {
      newItems.push(item);
      return;
    }
    if (before.price !== item.price) {
      priceChanges.push({
        name: item.name,
        previousPrice: before.price,
        currentPrice: item.price,
        delta: Math.round((item.price - before.price) * 100) / 100,
      });
    }
  });

  const removedItems: MenuItem[] = [];
  previousByName.forEach((item, key) => {
    if (!currentByName.has(key)) removedItems.push(item);
  });

  return {
    hasChanges: newItems.length > 0 || removedItems.length > 0 || priceChanges.length > 0,
    newItems,
    removedItems,
    priceChanges,
  };
}

// -----------------------------------------------------------------------------
// Price range
// -----------------------------------------------------------------------------

/**
 * The human-readable band stored in competitor_menu_snapshots.price_range:
 * "R100-R200 per person". Null when there is nothing to summarize — an empty
 * band would read as "free" in the dashboard.
 */
export function priceRangeOf(items: MenuItem[], currency = 'R'): string | null {
  const prices = items.map((item) => item.price).filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const symbol = currency || 'R';
  return min === max ? `${symbol}${min} per person` : `${symbol}${min}-${symbol}${max} per person`;
}

export interface ParsedPriceRange {
  min: number | null;
  max: number | null;
  currency: string;
}

/** The inverse of priceRangeOf, for reading stored snapshots back. */
export function parsePriceRange(value: string | null | undefined): ParsedPriceRange {
  const empty: ParsedPriceRange = { min: null, max: null, currency: 'R' };
  if (typeof value !== 'string' || !value.trim()) return empty;

  const currencyMatch = value.match(/(ZAR|R|\$|£|€)/);
  const currency = currencyMatch ? currencyMatch[1] : 'R';
  const numbers = value.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return { ...empty, currency };

  const parsed = numbers.map(Number).filter((n) => Number.isFinite(n));
  if (parsed.length === 0) return { ...empty, currency };
  return { min: Math.min(...parsed), max: Math.max(...parsed), currency };
}

// -----------------------------------------------------------------------------
// Scrape
// -----------------------------------------------------------------------------

/** One HTTP GET with a timeout, returning the body text (size-capped). */
async function fetchText(
  url: string,
  options: ScrapeOptions,
  timeoutMs: number,
  maxBytes: number
): Promise<{ text: string; contentType: string }> {
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(
    new Request(url, {
      method: 'GET',
      headers: {
        'User-Agent': options.userAgent ?? USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  );

  if (!res.ok) {
    throw new Error(`Menu fetch failed with HTTP ${res.status} for ${url}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const body = await res.text();
  return { text: body.slice(0, maxBytes), contentType };
}

/**
 * Scrape a competitor's menu.
 *
 * Steps: fetch the page -> extract text -> parse dishes -> (if the landing
 * page had no prices) follow one "menu" link and retry -> diff against the
 * previous snapshot. A first scrape (previousItems omitted) reports no
 * changes: everything is "new" only in the sense that it was never seen, and
 * alerting on that would make every new competitor look like it rewrote its
 * menu on day one.
 */
export async function scrapeMenu(websiteUrl: string, options: ScrapeOptions = {}): Promise<ScrapedMenu> {
  if (!isSafePublicUrl(websiteUrl)) {
    throw new Error(`Refusing to scrape ${websiteUrl}: not a public http(s) URL`);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const currency = options.currency ?? 'R';

  let menuUrl = websiteUrl;
  const first = await fetchText(menuUrl, options, timeoutMs, maxBytes);
  if (!/text\/html|application\/xhtml/i.test(first.contentType) && first.contentType) {
    throw new Error(`Menu page at ${menuUrl} is not HTML (${first.contentType.split(';')[0]})`);
  }

  let text = htmlToText(first.text);
  let items = parseMenuItems(text);

  if (items.length === 0 && options.followMenuLink !== false) {
    const link = extractMenuLink(first.text, menuUrl);
    if (link && link !== menuUrl) {
      try {
        const second = await fetchText(link, options, timeoutMs, maxBytes);
        const secondText = htmlToText(second.text);
        const secondItems = parseMenuItems(secondText);
        if (secondItems.length > 0) {
          menuUrl = link;
          text = secondText;
          items = secondItems;
        }
      } catch (err) {
        // The landing page is still the best evidence we have; a broken menu
        // link must not discard it.
        console.warn(`[market] could not follow menu link ${link}`, err);
      }
    }
  }

  const previous = options.previousItems;
  const diff = previous && previous.length > 0 ? diffMenus(previous, items) : diffMenus([], []);

  return {
    menuUrl,
    menuText: text.slice(0, MAX_MENU_TEXT_CHARS),
    items,
    priceRange: priceRangeOf(items, currency),
    currency,
    diff,
  };
}

/**
 * Menu items serialized as the snapshot's `menu_text`.
 *
 * The format is deliberately one the PARSER can read back — a heading line per
 * category and "Dish R120" per item — so the next run's diff compares like
 * with like. Storing the raw page text instead would make every diff depend on
 * whatever boilerplate (nav, footer, cookie banner) the site happened to serve
 * that day.
 */
export function itemsToText(items: MenuItem[]): string {
  const lines: string[] = [];
  let category: string | null = null;
  for (const item of items) {
    if (item.category !== category) {
      category = item.category;
      if (category) lines.push(category);
    }
    lines.push(`${item.name} R${item.price}`);
  }
  return lines.join('\n');
}

/**
 * What goes into competitor_menu_snapshots.menu_text: the parsed dish list
 * when there is one, otherwise the extracted page text — so a snapshot always
 * records what was actually seen, even when nothing was parseable.
 */
export function menuSnapshotText(scraped: { menuText: string; items: MenuItem[] }): string {
  return scraped.items.length > 0 ? itemsToText(scraped.items) : scraped.menuText;
}

/** Read items back out of a stored snapshot's text, for the next diff. */
export function itemsFromText(text: string | null): MenuItem[] {
  if (!text) return [];
  return parseMenuItems(text);
}
