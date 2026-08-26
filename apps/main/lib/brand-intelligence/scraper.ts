/**
 * Brand Intelligence Engine — site scraper.
 *
 * Extracts a restaurant's branding (logo, colours, fonts, name, tagline,
 * menu, hours) from the HTML of its website. It is deliberately framework
 * free (no cheerio, no DOM, no external HTTP client) so the extraction
 * logic can be unit-tested with a plain HTML string and so it degrades to
 * a graceful fallback instead of throwing when a site is unreachable.
 *
 * The live `scrapeUrl()` wrapper does the I/O (fetch) and hands the HTML to
 * the pure `extractBrandProfile()`; every decision about what a brand
 * "looks like" lives in the pure function below.
 */

export interface BrandProfile {
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  fontFamily: string | null;
  brandName: string;
  tagline: string | null;
  menuJson: unknown;
  hoursJson: unknown;
  confidence: number;
}

export interface MenuItem {
  name: string;
  price: string | null;
  description?: string | null;
}

export interface HoursDay {
  day: string;
  opens: string | null;
  closes: string | null;
}

const DEFAULT_BRAND: Omit<BrandProfile, 'confidence'> = {
  logoUrl: null,
  primaryColor: '#1F6F5C',
  secondaryColor: '#C9A25A',
  backgroundColor: '#0B1210',
  fontFamily: null,
  brandName: 'Flavourly',
  tagline: null,
  menuJson: [],
  hoursJson: [],
};

/** Normalise a CSS colour token to a lower-case hex string, or null. */
export function normalizeColor(value: string | undefined | null): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();

  // #abc / #aabbcc
  const hex = /^#([0-9a-f]{3})$/i.exec(v) || /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const g = hex[1];
    return g.length === 3 ? `#${g[0]}${g[0]}${g[1]}${g[1]}${g[2]}${g[2]}` : `#${g}`;
  }

  // rgb(255, 255, 255) / rgba(255,255,255,0.8)
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(v);
  if (rgb) {
    const toHex = (n: string) => Number(n).toString(16).padStart(2, '0');
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
  }

  return null;
}

/** Distinguish a "background-ish" (very light or very dark) colour from an accent. */
function isNeutral(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/.exec(hex);
  if (!m) return false;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const avg = (r + g + b) / 3;
  return avg < 40 || avg > 220;
}

/** Pick the most "brand-defining" colours: an accent, a secondary and a background. */
export function pickColors(candidates: string[]): BrandProfile['primaryColor' | 'secondaryColor' | 'backgroundColor'] {
  // Normalise FIRST: isNeutral() and the #rrggbb regex expect lower-case hex,
  // and a candidate like rgb(176,141,87) must become '#b08d57' before we
  // classify it — otherwise the raw token slips through as a "colour" and can
  // win primary over a real brand accent.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of candidates) {
    const h = normalizeColor(c);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    unique.push(h);
  }

  const accents = unique.filter((c) => !isNeutral(c));
  const neutrals = unique.filter((c) => isNeutral(c));
  const background = neutrals[0] ?? accents[accents.length - 1] ?? DEFAULT_BRAND.backgroundColor;

  const primary = accents[0] ?? DEFAULT_BRAND.primaryColor;
  const secondary =
    accents.find((c) => c !== primary && c !== background) ??
    DEFAULT_BRAND.secondaryColor;

  return { primaryColor: primary, secondaryColor: secondary, backgroundColor: background };
}

/** Extract every CSS hex/rgb colour token from an HTML + embedded <style> string. */
export function collectColors(html: string, css: string | null): string[] {
  const tokens: string[] = [];
  const push = (m: string) => tokens.push(m);
  const htmlHex = html.match(/#[0-9a-f]{3}\b|[0-9a-f]{6}\b/gi) ?? [];
  for (const h of htmlHex) push(h.startsWith('#') ? h : `#${h}`);
  const cssColors = (css ?? '').match(/#[0-9a-f]{3,6}\b|rgba?\([^)]*\)/gi) ?? [];
  for (const c of cssColors) push(c);
  return tokens;
}

/** Best-guess font family for the brand from a body / h1 rule. */
export function extractFontFamily(css: string | null): string | null {
  if (!css) return null;
  const bodyFont = /body\s*\{[^}]*font-family\s*:\s*([^;}]+)/i.exec(css);
  const h1Font = /h1[^{]*\{[^}]*font-family\s*:\s*([^;}]+)/i.exec(css);
  const font = (bodyFont ?? h1Font)?.[1]?.trim();
  if (!font) return null;
  // Collapse to the font name (drop @import/url forms and trailing fallbacks).
  const names = font.replace(/['"]/g, '').split(',');
  const first = names[0]?.trim() ?? null;
  return first || null;
}

/**
 * Pure brand extraction from raw HTML.
 *
 * Returns a completed BrandProfile with defaults filled in for anything it
 * could not find, and a confidence score in [0, 1] reflecting how many of the
 * core signals were actually extracted.
 */
export function extractBrandProfile(html: string): BrandProfile {
  const source = html || '';

  // ── Brand name ──────────────────────────────────────────────────────────
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(source)?.[1]?.trim();
  const ogTitle = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(source)?.[1];
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(source)?.[1]?.replace(/<[^>]+>/g, '').trim();
  const brandName = (ogTitle || h1 || title || DEFAULT_BRAND.brandName).split('|')[0].split('–')[0].split('—')[0].trim();

  // ── Tagline ─────────────────────────────────────────────────────────────
  const ogDescription =
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i.exec(source)?.[1];
  const metaDescription =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i.exec(source)?.[1];
  const tagline = ogDescription || metaDescription || DEFAULT_BRAND.tagline;

  // ── Logo ────────────────────────────────────────────────────────────────
  const ogImage = /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(source)?.[1];
  const linkIcon = /<link[^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i.exec(source)?.[1];
  // A candidate <img> whose alt/src hints at a logo/wordmark rather than a hero photo.
  const logoImg =
    /<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["']/i.exec(source);
  const looksLikeLogo = logoImg && /logo|brand|wordmark|mark/i.test(logoImg[2] ?? '');
  const logoUrl = ogImage || (looksLikeLogo ? logoImg![1] : null) || linkIcon || null;

  // ── Colours & font ──────────────────────────────────────────────────────
  const css = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(source)?.[1] ?? null;
  const colors = pickColors(collectColors(source, css));
  const fontFamily = extractFontFamily(css);

  // ── Menu (JSON-LD Restaurant schema, falling back to an on-page list) ───
  const menuJson = extractMenu(source);

  // ── Hours (JSON-LD openingHours, falling back to plain text) ────────────
  const hoursJson = extractHours(source);

  // ── Confidence ──────────────────────────────────────────────────────────
  let found = 0;
  let total = 6;
  if (brandName && brandName !== DEFAULT_BRAND.brandName) found++;
  if (tagline) found++;
  if (logoUrl) found++;
  if (colors.primaryColor !== DEFAULT_BRAND.primaryColor) found++;
  if (fontFamily) found++;
  if ((menuJson as MenuItem[]).length > 0) found++;
  const confidence = Math.min(1, found / total);

  return {
    logoUrl,
    primaryColor: colors.primaryColor,
    secondaryColor: colors.secondaryColor,
    backgroundColor: colors.backgroundColor,
    fontFamily,
    brandName,
    tagline,
    menuJson,
    hoursJson,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/** Extract a dish list from JSON-LD Restaurant menu or basic <li>/<h3> text. */
export function extractMenu(html: string): MenuItem[] {
  const jsonLd = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  if (jsonLd) {
    try {
      const parsed = JSON.parse(jsonLd);
      const hasMenu = Array.isArray(parsed)
        ? parsed.some((b) => b['@type'] === 'Restaurant')
        : parsed['@type'] === 'Restaurant';
      if (hasMenu) {
        const data = Array.isArray(parsed)
          ? parsed.find((b) => b['@type'] === 'Restaurant')
          : parsed;
        const hasMenuSection = data.hasMenuSection ?? data.menu ?? null;
        if (hasMenuSection) {
          return normalizeJsonLdMenu(hasMenuSection);
        }
      }
    } catch {
      // Malformed JSON-LD — fall through to text parsing.
    }
  }

  return extractMenuFromText(html);
}

function normalizeJsonLdMenu(menu: unknown): MenuItem[] {
  const items: MenuItem[] = [];
  const sections = Array.isArray(menu)
    ? menu
    : [menu];
  for (const section of sections) {
    const entries =
      (section as any)?.hasMenuItem ??
      (section as any)?.menuItems ??
      (section as any)?.hasMenuSection ??
      [];
    const list = Array.isArray(entries) ? entries : [entries];
    for (const entry of list) {
      if (Array.isArray(entry)) {
        items.push(...normalizeJsonLdMenu(entry));
        continue;
      }
      const name = (entry as any)?.name ?? '';
      // name may carry the price inline, e.g. "Beef Burger (R120)".
      const priceMatch = /\(?R\s?([\d.,]+)\)?/.exec(String(name));
      const price = priceMatch ? `R${priceMatch[1]}` : null;
      const description = (entry as any)?.description ?? null;
      items.push({
        name: String(name).replace(/\(?R\s?[\d.,]+\)?/, '').trim(),
        price,
        description: description ? String(description) : null,
      });
    }
  }
  return items.slice(0, 60);
}

function extractMenuFromText(html: string): MenuItem[] {
  // Very rough heuristic: <h3> (dish) followed by a line containing R<amount>.
  const blocks = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)];
  const items: MenuItem[] = [];
  for (const block of blocks) {
    // Strip tags AND any inline "(Rxxx)" price so the dish name is clean
    // (e.g. "<h3>Tomahawk (R595)</h3>" -> "Tomahawk") rather than keeping the
    // price embedded and breaking the name -> price pairing below.
    const name = block[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\(?R\s?[\d.,]+\)?/, '')
      .trim();
    if (!name) continue;
    const window = html.slice(block.index ?? 0, (block.index ?? 0) + 800);
    const priceMatch = /\bR\s?([\d.,]+)/.exec(window.replace(/<[^>]+>/g, ' '));
    if (priceMatch) {
      items.push({ name, price: `R${priceMatch[1]}` });
    }
  }
  return items.slice(0, 60);
}

/** Extract operating hours from JSON-LD openingHoursSpecification or a simple table/text. */
export function extractHours(html: string): HoursDay[] {
  const jsonLd = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  if (jsonLd) {
    try {
      const parsed = JSON.parse(jsonLd);
      const data = Array.isArray(parsed)
        ? parsed.find((b) => b['@type'] === 'Restaurant')
        : parsed;
      const spec = data?.openingHoursSpecification;
      if (Array.isArray(spec)) {
        const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        return spec
          .map((s: any) => {
            // JSON-LD dayOfWeek is often a schema.org URL, e.g.
            // "https://schema.org/Monday" — take the final path segment and
            // match it case-insensitively to our day list.
            const dayStr = String(s.dayOfWeek ?? '');
            const dayName = dayStr.split('/').pop() || dayStr;
            const idx = DAYS.findIndex((d) => d.toLowerCase() === dayName.toLowerCase());
            return {
              day: idx >= 0 ? DAYS[idx] : dayName,
              opens: s.opens ?? null,
              closes: s.closes ?? null,
            };
          })
          .filter((d: HoursDay) => d.day);
      }
    } catch {
      // fall through
    }
  }
  return extractHoursFromText(html);
}

function extractHoursFromText(html: string): HoursDay[] {
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  const hours: HoursDay[] = [];
  for (const day of DAYS) {
    const re = new RegExp(`${day.toLowerCase()}[^a-z]{0,20}(\\d{1,2}(?::\\d{2})?)\\s*(?:am|pm)?\\s*[-–to]+\\s*(\\d{1,2}(?::\\d{2})?)\\s*(?:am|pm)?`);
    const m = re.exec(text);
    if (m) {
      hours.push({ day, opens: m[1], closes: m[2] });
    }
  }
  return hours;
}

/**
 * Live wrapper: fetch a URL and run the pure extractor. Never throws — any
 * network/DNS/status failure is returned as a low-confidence fallback profile
 * so callers (the demo tenant builder) can still create a tenant and let the
 * owner fill in the brand later.
 */
export async function scrapeUrl(url: string): Promise<BrandProfile & { fetched: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Flavourly-BrandIntel/1.0', Accept: 'text/html' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ...DEFAULT_BRAND, confidence: 0.1, fetched: false, error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const profile = extractBrandProfile(html);
    return { ...profile, fetched: true };
  } catch (err: any) {
    return { ...DEFAULT_BRAND, confidence: 0.1, fetched: false, error: err?.message ?? 'fetch failed' };
  }
}
