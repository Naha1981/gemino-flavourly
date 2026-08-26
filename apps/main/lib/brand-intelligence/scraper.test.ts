import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBrandProfile,
  normalizeColor,
  pickColors,
  extractFontFamily,
  extractMenu,
  extractHours,
  type MenuItem,
  type HoursDay,
} from './scraper.ts';

/** Realistic restaurant homepage HTML exercising every extraction path. */
const SAMPLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Marble Johannesburg | Fine Dining</title>
  <meta property="og:title" content="Marble Johannesburg" />
  <meta property="og:description" content="Contemporary steakhouse by Chef David Higgs in Rosebank." />
  <meta property="og:image" content="https://marble.restaurant/logo.png" />
  <link rel="icon" href="/favicon.ico" />
  <meta name="theme-color" content="#B08D57" />
  <style>
    :root { --brand: #B08D57; --night: #0B0B0B; }
    body { font-family: 'Fraunces', Georgia, serif; background: #0B0B0B; color: #f5f1ea; }
    h1 { font-family: 'Fraunces', Georgia, serif; color: #B08D57; }
    .btn { background: rgb(176, 141, 87); }
    a:hover { color: #C9A25A; }
  </style>
  <script type="application/ld+json">
  {
    "@type": "Restaurant",
    "name": "Marble Johannesburg",
    "servesCuisine": "Steakhouse",
    "openingHoursSpecification": [
      { "@type": "OpeningHoursSpecification", "dayOfWeek": "https://schema.org/Monday", "opens": "12:00", "closes": "22:00" },
      { "@type": "OpeningHoursSpecification", "dayOfWeek": "https://schema.org/Saturday", "opens": "18:00", "closes": "23:00" }
    ],
    "hasMenuSection": {
      "@type": "MenuSection",
      "name": "Mains",
      "hasMenuItem": [
        { "@type": "MenuItem", "name": "Beef Fillet (R385)" },
        { "@type": "MenuItem", "name": "Grilled Prawns", "description": "Lemon butter, sea salt" }
      ]
    }
  }
  </script>
</head>
<body>
  <h1>Marble Johannesburg</h1>
  <img src="/assets/logo-mark.png" alt="Marble logo" width="120" />
  <p>Contemporary steakhouse by Chef David Higgs in Rosebank.</p>
  <h3>Tomahawk (R595)</h3>
</body>
</html>`;

describe('Brand Intelligence Engine — colour extraction', () => {
  test('normalizes hex and rgb() colours to lower-case hex', () => {
    assert.equal(normalizeColor('#B08D57'), '#b08d57');
    assert.equal(normalizeColor('#ABC'), '#aabbcc');
    assert.equal(normalizeColor('rgb(176, 141, 87)'), '#b08d57');
    assert.equal(normalizeColor('rgba(11,11,11,0.9)'), '#0b0b0b');
    assert.equal(normalizeColor('not-a-colour'), null);
    assert.equal(normalizeColor(undefined), null);
  });

  test('pickColors separates a dark background from brand accent colours', () => {
    const { primaryColor, secondaryColor, backgroundColor } = pickColors([
      '#0B0B0B',
      '#B08D57',
      '#C9A25A',
      '#FFFFFF',
    ]);
    assert.equal(backgroundColor, '#0b0b0b'); // dark neutral wins as background
    assert.equal(primaryColor, '#b08d57'); // first accent = primary
  });

  test('extracts the primary brand colour and dark background from sample CSS', () => {
    const profile = extractBrandProfile(SAMPLE_HTML);
    assert.equal(profile.primaryColor, '#b08d57');
    assert.equal(profile.backgroundColor, '#0b0b0b');
  });

  test('extracts the serif body font', () => {
    const css = `body { font-family: 'Fraunces', Georgia, serif; }`;
    assert.equal(extractFontFamily(css), 'Fraunces');
  });
});

describe('Brand Intelligence Engine — name, tagline, logo, menu, hours', () => {
  test('extracts brand name from og:title over <title>', () => {
    const profile = extractBrandProfile(SAMPLE_HTML);
    assert.equal(profile.brandName, 'Marble Johannesburg');
  });

  test('extracts tagline from og:description', () => {
    assert.equal(
      extractBrandProfile(SAMPLE_HTML).tagline,
      'Contemporary steakhouse by Chef David Higgs in Rosebank.'
    );
  });

  test('extracts a logo URL from og:image (falls back to favicon / logo img)', () => {
    assert.equal(extractBrandProfile(SAMPLE_HTML).logoUrl, 'https://marble.restaurant/logo.png');
  });

  test('recognises an <img alt="...logo"> as the logo when og:image is absent', () => {
    const html = SAMPLE_HTML.replace(/<meta property="og:image"[^>]*\/?>/, '');
    const profile = extractBrandProfile(html);
    assert.ok(profile.logoUrl, 'expected a logo URL from the logo-mark image');
    assert.match(profile.logoUrl!, /logo-mark/);
  });

  test('parses menu items from JSON-LD with inline R-prices', () => {
    const menu = extractMenu(SAMPLE_HTML) as MenuItem[];
    assert.ok(menu.length >= 2, `expected menu items, got ${menu.length}`);
    const beef = menu.find((m) => m.name === 'Beef Fillet');
    assert.ok(beef, 'Beef Fillet not found');
    assert.equal(beef.price, 'R385');
    const prawns = menu.find((m) => m.name === 'Grilled Prawns');
    assert.ok(prawns?.description, 'expected a description');
  });

  test('falls back to on-page <h3> + price parsing when there is no JSON-LD menu', () => {
    const noLd = SAMPLE_HTML.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/i, '');
    const menu = extractMenu(noLd) as MenuItem[];
    const tomahawk = menu.find((m) => m.name === 'Tomahawk');
    assert.ok(tomahawk, 'Tomahawk not found in text menu');
    assert.equal(tomahawk.price, 'R595');
  });

  test('parses operating hours from JSON-LD openingHoursSpecification', () => {
    const hours = extractHours(SAMPLE_HTML) as HoursDay[];
    const monday = hours.find((d) => d.day === 'Monday');
    assert.ok(monday, 'Monday hours not found');
    assert.equal(monday.opens, '12:00');
    assert.equal(monday.closes, '22:00');
  });

  test('fills safe defaults and a low confidence score when the site is unparseable', () => {
    const profile = extractBrandProfile('<html><body>Coming soon</body></html>');
    assert.equal(profile.brandName, 'Flavourly');
    assert.ok(profile.confidence <= 0.34);
    assert.match(profile.primaryColor, /^#/);
  });
});
