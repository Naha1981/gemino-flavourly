/**
 * Gate #16 — menu scraper, framework-free.
 *
 * Restaurant websites are wildly heterogeneous, so this is a deliberately
 * conservative text pipeline rather than a DOM parser:
 *
 *   fetch HTML -> strip script/style/tags -> collapse whitespace ->
 *   split lines -> keep lines that carry an R-rand price ->
 *   { name, priceCents } per line + a price-range summary
 *
 * The price heuristic accepts "R95", "R 95", "R95.00", "R95,00" (the comma
 * form is common on SA sites) and requires the item text to be short
 * enough to be a menu line, not a paragraph. Anything unparsable degrades
 * to "no items" — the snapshot keeps the raw text, so a future parser can
 * re-run against history without re-fetching.
 *
 * compareMenus() is pure diff over two item lists: the cron stores a new
 * snapshot only when it differs from the latest stored one.
 */

export interface MenuItem {
  name: string;
  priceCents: number;
}

export interface ScrapedMenu {
  menuUrl: string;
  menuText: string;
  items: MenuItem[];
  priceRange: string | null;
}

/** Strip a fetched HTML document down to readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** R-price pattern: R95 / R 95 / R95.00 / R95,00 (cents optional). */
const PRICE_PATTERN = /R\s?(\d{1,4})(?:[.,](\d{2}))?\b/;

/** A line is a menu item when it carries an R-price and looks like a line,
 *  not a paragraph (long lines are usually prose that happens to mention
 *  a price). */
export function parseMenuItems(text: string): MenuItem[] {
  const items: MenuItem[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.length > 120) continue;
    const match = line.match(PRICE_PATTERN);
    if (!match) continue;

    const rands = Number(match[1]);
    const cents = match[2] ? Number(match[2]) : 0;
    if (!Number.isFinite(rands) || rands <= 0) continue;

    const name = line
      .replace(PRICE_PATTERN, ' ')
      .replace(/[•·|—–]\s*$/g, ' ')
      .replace(/\.{2,}/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (name.length < 2) continue; // just a bare price, no item to name
    items.push({ name, priceCents: Math.round(rands * 100 + cents) });
  }
  return items;
}

/** "R95 - R220 per person" summary (min..max of parsed items). */
export function summarizePriceRange(items: MenuItem[]): string | null {
  if (items.length === 0) return null;
  const prices = items.map((item) => item.priceCents / 100);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return `R${min.toFixed(0)} per person`;
  return `R${min.toFixed(0)}-R${max.toFixed(0)} per person`;
}

export async function fetchWebsiteText(
  url: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<string> {
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(url, {
    headers: { 'User-Agent': 'GeminoMarketBot/1.0 (+menu tracking)' },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Fetch ${url} failed: ${res.status}`);
  }
  const body = await res.text();
  return htmlToText(body);
}

export async function scrapeMenu(
  websiteUrl: string,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<ScrapedMenu> {
  const menuText = await fetchWebsiteText(websiteUrl, options);
  const items = parseMenuItems(menuText);
  return {
    menuUrl: websiteUrl,
    menuText: menuText.slice(0, 60_000),
    items,
    priceRange: summarizePriceRange(items),
  };
}

// -----------------------------------------------------------------------------
// Diffing (pure)
// -----------------------------------------------------------------------------

export interface PriceChange {
  name: string;
  fromCents: number;
  toCents: number;
}

export interface MenuDiff {
  hasChanges: boolean;
  newItems: MenuItem[];
  removedItems: MenuItem[];
  priceChanges: PriceChange[];
}

function keyOf(item: MenuItem): string {
  return item.name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Set-difference + price comparison over two item lists. */
export function compareMenus(previous: MenuItem[], current: MenuItem[]): MenuDiff {
  const previousByKey = new Map(previous.map((item) => [keyOf(item), item]));
  const currentByKey = new Map(current.map((item) => [keyOf(item), item]));

  const newItems: MenuItem[] = [];
  for (const entry of Array.from(currentByKey.entries())) {
    if (!previousByKey.has(entry[0])) newItems.push(entry[1]);
  }

  const removedItems: MenuItem[] = [];
  const priceChanges: PriceChange[] = [];
  for (const entry of Array.from(previousByKey.entries())) {
    const item = entry[1];
    const stillThere = currentByKey.get(entry[0]);
    if (!stillThere) {
      removedItems.push(item);
    } else if (stillThere.priceCents !== item.priceCents) {
      priceChanges.push({ name: item.name, fromCents: item.priceCents, toCents: stillThere.priceCents });
    }
  }

  return {
    hasChanges: newItems.length > 0 || removedItems.length > 0 || priceChanges.length > 0,
    newItems,
    removedItems,
    priceChanges,
  };
}
