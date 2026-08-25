import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities,
  diffMenus,
  extractMenuLink,
  htmlToText,
  isSafePublicUrl,
  itemsFromText,
  itemsToText,
  menuSnapshotText,
  normalizeItemName,
  parseLinePrice,
  parseMenuItems,
  parsePriceRange,
  priceRangeOf,
  resolveUrl,
  scrapeMenu,
  type MenuItem,
} from './menu-scraper.ts';

function fakeFetch(
  responses: Record<string, { status?: number; body: string; contentType?: string }>
) {
  const urls: string[] = [];
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    const next = responses[url] ?? { status: 404, body: 'not found' };
    return new Response(next.body, {
      status: next.status ?? 200,
      headers: { 'Content-Type': next.contentType ?? 'text/html; charset=utf-8' },
    });
  };
  return { impl: impl as unknown as typeof fetch, urls };
}

const MENU_HTML = `
<html><head><title>The Bull Pen</title>
<style>body { color: red }</style>
<script>var tracking = "Steak R9999";</script>
</head><body>
<nav><a href="/">Home</a><a href="/menu">Our Menu</a></nav>
<h1>Welcome to The Bull Pen</h1>
<p>We open 18:00 daily. Serves 4 families.</p>
<section>
  <h2>Starters</h2>
  <ul>
    <li>Soup of the day ......... R65</li>
    <li>Garlic bread &mdash; R45</li>
  </ul>
  <h2>Mains</h2>
  <ul>
    <li>Ribeye steak (300g) R280</li>
    <li>Veggie burger R120</li>
    <li>Add R20 for extra cheese</li>
  </ul>
</section>
<footer>Delivery fee R35 applies. &copy; 2026</footer>
</body></html>`;

describe('menu scraper: html -> text', () => {
  test('scripts, styles and comments are dropped, block tags become lines', () => {
    const text = htmlToText('<div>Line one</div><p>Line two</p><script>bad "Steak R1"</script><style>x{}</style>');
    assert.equal(text, 'Line one\nLine two');
  });

  test('menu structure survives as one line per row', () => {
    const text = htmlToText(MENU_HTML);
    assert.match(text, /Soup of the day \.+ R65/);
    assert.match(text, /Ribeye steak \(300g\) R280/);
    assert.doesNotMatch(text, /Steak R9999/, 'script contents must not leak into the text');
    assert.doesNotMatch(text, /color: red/);
  });

  test('entities decode, including the currency symbols menus rely on', () => {
    assert.equal(decodeEntities('Soup &amp; bread'), 'Soup & bread');
    assert.equal(decodeEntities('Garlic bread &mdash; R45'), 'Garlic bread - R45');
    assert.equal(decodeEntities('Steak &#8360;'), 'Steak ₨');
    assert.equal(decodeEntities('Caf&eacute;'), 'Café');
    assert.equal(decodeEntities('&#x2014; done'), '— done');
    assert.equal(decodeEntities('&unknown; stays'), '&unknown; stays');
  });
});

describe('menu scraper: price parsing', () => {
  test('currency prices are read from the end of the line', () => {
    assert.deepEqual(parseLinePrice('Ribeye steak (300g) R280'), { price: 280, currency: 'R', index: 20 });
    assert.equal(parseLinePrice('Burger R 120')?.price, 120);
    assert.equal(parseLinePrice('Platter R1 200')?.price, 1200);
    assert.equal(parseLinePrice('Cake R65.50')?.price, 65.5);
    assert.equal(parseLinePrice('Wine $12')?.currency, '$');
    assert.equal(parseLinePrice('Wine ZAR 12')?.currency, 'ZAR');
  });

  test('the LAST price on a line wins (descriptions quote other amounts)', () => {
    assert.equal(parseLinePrice('Steak, add R20 for cheese R180')?.price, 180);
  });

  test('a serving note or size after the price is fine, a sentence is not', () => {
    assert.equal(parseLinePrice('Ribeye R280 (300g)')?.price, 280);
    assert.equal(parseLinePrice('Ribeye R280 ea')?.price, 280);
    assert.equal(parseLinePrice('Ribeye R280*')?.price, 280);
    assert.equal(parseLinePrice('Add R20 for extra cheese'), null);
    assert.equal(parseLinePrice('Delivery fee R35 applies.'), null);
  });

  test('bare trailing numbers are accepted only for plausible dishes', () => {
    assert.equal(parseLinePrice('Veggie burger 120')?.price, 120);
    assert.equal(parseLinePrice('Serves 4'), null, 'too small to be a price');
    assert.equal(parseLinePrice('Opens 18'), null, 'a sentence, not a dish');
    assert.equal(parseLinePrice('Book 2024'), null, 'non-dish verb');
    assert.equal(parseLinePrice('Opens at 18:00'), null);
    assert.equal(parseLinePrice('Free delivery'), null);
    assert.equal(parseLinePrice('R50')?.price, 50, 'a bare price still parses…');
    assert.deepEqual(parseMenuItems('R50'), [], '…but a price with no dish name is not an item');
    assert.deepEqual(parseMenuItems('Add R20 for extra cheese'), [], 'a price inside a sentence is not a dish');
  });

  test('dish names are normalized for matching but not for display', () => {
    assert.equal(normalizeItemName('  Ribeye   Steak (300g) — '), 'ribeye steak 300g');
    assert.equal(normalizeItemName('Café au Lait'), 'cafe au lait');
    assert.equal(normalizeItemName('!!!'), '');
  });
});

describe('menu scraper: item extraction', () => {
  test('extracts dishes with their nearest section heading', () => {
    const items = parseMenuItems(htmlToText(MENU_HTML));
    const names = items.map((item) => item.name);

    assert.ok(names.includes('Soup of the day'), names.join(', '));
    assert.ok(names.includes('Garlic bread'));
    assert.ok(names.includes('Ribeye steak (300g)'));
    assert.ok(names.includes('Veggie burger'));
    assert.equal(items.find((i) => i.name === 'Soup of the day')?.price, 65);
    assert.equal(items.find((i) => i.name === 'Soup of the day')?.category, 'Starters');
    assert.equal(items.find((i) => i.name === 'Ribeye steak (300g)')?.category, 'Mains');
    assert.equal(items.find((i) => i.name === 'Garlic bread')?.price, 45);
  });

  test('non-dish lines with a price are excluded', () => {
    const items = parseMenuItems(htmlToText(MENU_HTML));
    assert.equal(items.find((i) => /delivery fee/i.test(i.name)), undefined, 'delivery fee is not a dish');
    // "Add R20 for extra cheese" has no dish name in front of the price.
    assert.equal(items.find((i) => /^add\b/i.test(i.name)), undefined);
  });

  test('a page with no prices yields no items rather than invented ones', () => {
    const items = parseMenuItems('About us\nWe are a family restaurant\nEst 1998');
    assert.deepEqual(items, []);
  });

  test('duplicate dish+price pairs are stored once', () => {
    const items = parseMenuItems('Burger R120\nBurger R120\nBurger R140');
    assert.equal(items.length, 2);
  });
});

describe('menu scraper: diffing', () => {
  const previous: MenuItem[] = [
    { name: 'Soup of the day', price: 65, category: 'Starters' },
    { name: 'Ribeye steak', price: 280, category: 'Mains' },
    { name: 'Prawn salad', price: 150, category: 'Starters' },
  ];
  const current: MenuItem[] = [
    { name: 'soup of the day!', price: 70, category: 'Starters' }, // same dish, new price
    { name: 'Ribeye steak', price: 280, category: 'Mains' }, // unchanged
    { name: 'Veggie burger', price: 120, category: 'Mains' }, // new
  ];

  test('detects new, removed and repriced items', () => {
    const diff = diffMenus(previous, current);
    assert.equal(diff.hasChanges, true);
    assert.deepEqual(diff.newItems.map((i) => i.name), ['Veggie burger']);
    assert.deepEqual(diff.removedItems.map((i) => i.name), ['Prawn salad']);
    assert.deepEqual(diff.priceChanges, [
      { name: 'soup of the day!', previousPrice: 65, currentPrice: 70, delta: 5 },
    ]);
  });

  test('an identical menu reports no changes', () => {
    const diff = diffMenus(previous, [...previous].reverse());
    assert.equal(diff.hasChanges, false);
    assert.deepEqual(diff.newItems, []);
    assert.deepEqual(diff.removedItems, []);
    assert.deepEqual(diff.priceChanges, []);
  });

  test('price changes are signed and keep cents exact', () => {
    const diff = diffMenus(
      [{ name: 'Cake', price: 65.5, category: null }],
      [{ name: 'Cake', price: 60.25, category: null }]
    );
    assert.deepEqual(diff.priceChanges, [
      { name: 'Cake', previousPrice: 65.5, currentPrice: 60.25, delta: -5.25 },
    ]);
  });

  test('matching ignores case, punctuation and accents', () => {
    const diff = diffMenus([{ name: 'Crème Brûlée', price: 55, category: null }], [
      { name: 'creme brulee', price: 55, category: null },
    ]);
    assert.equal(diff.hasChanges, false);
  });
});

describe('menu scraper: price ranges', () => {
  test('summarizes the cheapest and priciest dish', () => {
    const items: MenuItem[] = [
      { name: 'Soup', price: 65, category: null },
      { name: 'Steak', price: 280, category: null },
    ];
    assert.equal(priceRangeOf(items), 'R65-R280 per person');
    assert.equal(priceRangeOf([{ name: 'Cake', price: 120, category: null }]), 'R120 per person');
    assert.equal(priceRangeOf([]), null);
    assert.equal(priceRangeOf(items, '$'), '$65-$280 per person');
  });

  test('a stored range parses back into its band', () => {
    assert.deepEqual(parsePriceRange('R100-R200 per person'), { min: 100, max: 200, currency: 'R' });
    assert.deepEqual(parsePriceRange('$20 per person'), { min: 20, max: 20, currency: '$' });
    assert.deepEqual(parsePriceRange(null), { min: null, max: null, currency: 'R' });
    assert.deepEqual(parsePriceRange('pricey'), { min: null, max: null, currency: 'R' });
  });

  test('priceRangeOf -> parsePriceRange round-trips', () => {
    const items: MenuItem[] = [
      { name: 'A', price: 100, category: null },
      { name: 'B', price: 200, category: null },
    ];
    const range = priceRangeOf(items);
    assert.deepEqual(parsePriceRange(range), { min: 100, max: 200, currency: 'R' });
  });
});

describe('menu scraper: snapshot text round-trip', () => {
  test('items serialize to a form the parser reads back unchanged', () => {
    const items: MenuItem[] = [
      { name: 'Soup of the day', price: 65, category: 'Starters' },
      { name: 'Garlic bread', price: 45, category: 'Starters' },
      { name: 'Ribeye steak (300g)', price: 280, category: 'Mains' },
    ];
    const text = itemsToText(items);
    assert.equal(
      text,
      ['Starters', 'Soup of the day R65', 'Garlic bread R45', 'Mains', 'Ribeye steak (300g) R280'].join('\n')
    );
    assert.deepEqual(itemsFromText(text), items);
  });

  test('a snapshot with no parseable items still stores the page text', () => {
    assert.equal(menuSnapshotText({ menuText: 'We are a family restaurant', items: [] }), 'We are a family restaurant');
    const items: MenuItem[] = [{ name: 'Soup', price: 65, category: null }];
    assert.equal(menuSnapshotText({ menuText: 'noise', items }), 'Soup R65');
  });

  test('an empty snapshot text parses to no items', () => {
    assert.deepEqual(itemsFromText(null), []);
    assert.deepEqual(itemsFromText(''), []);
  });
});

describe('menu scraper: url safety', () => {
  test('public http(s) hosts are allowed', () => {
    assert.equal(isSafePublicUrl('https://bullpen.example/menu'), true);
    assert.equal(isSafePublicUrl('http://8.8.8.8/menu'), true);
  });

  test('internal hosts and other schemes are refused', () => {
    for (const url of [
      'http://localhost:3000/api/migrate',
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://metadata.local/',
      'file:///etc/passwd',
      'ftp://example.com/menu',
      'not a url',
      '',
    ]) {
      assert.equal(isSafePublicUrl(url), false, `${url} should be refused`);
    }
  });

  test('relative menu links resolve against the page they came from', () => {
    assert.equal(resolveUrl('/menu', 'https://bullpen.example/'), 'https://bullpen.example/menu');
    assert.equal(resolveUrl('http://127.0.0.1/x', 'https://bullpen.example/'), null);
    assert.equal(resolveUrl('http://', 'https://bullpen.example/'), null);
  });

  test('a menu link is found by href or label', () => {
    assert.equal(extractMenuLink(MENU_HTML, 'https://bullpen.example/'), 'https://bullpen.example/menu');
    assert.equal(
      extractMenuLink('<a href="/spyskaart">Spyskaart</a>', 'https://x.example'),
      'https://x.example/spyskaart'
    );
    assert.equal(extractMenuLink('<a href="/about">About us</a>', 'https://x.example'), null);
  });
});

describe('menu scraper: scrapeMenu', () => {
  test('parses a menu page and reports no changes on the first scrape', async () => {
    const { impl, urls } = fakeFetch({ 'https://bullpen.example/': { body: MENU_HTML } });
    const result = await scrapeMenu('https://bullpen.example/', { fetchImpl: impl });

    assert.equal(urls.length, 1, 'a page with prices is not re-fetched');
    assert.equal(result.menuUrl, 'https://bullpen.example/');
    assert.ok(result.items.length >= 4);
    assert.equal(result.priceRange, 'R45-R280 per person');
    assert.equal(result.diff.hasChanges, false, 'a baseline scrape is not a menu change');
    assert.ok(result.menuText.length > 0);
    assert.ok(result.menuText.length <= 20_000);
  });

  test('follows one menu link when the landing page has no prices', async () => {
    const landing = '<html><body><h1>The Bull Pen</h1><a href="/our-menu">View our menu</a></body></html>';
    const { impl, urls } = fakeFetch({
      'https://bullpen.example/': { body: landing },
      'https://bullpen.example/our-menu': { body: MENU_HTML },
    });

    const result = await scrapeMenu('https://bullpen.example/', { fetchImpl: impl });
    assert.deepEqual(urls, ['https://bullpen.example/', 'https://bullpen.example/our-menu']);
    assert.equal(result.menuUrl, 'https://bullpen.example/our-menu');
    assert.ok(result.items.length >= 4);
  });

  test('a second scrape against the stored snapshot reports the change', async () => {
    const { impl } = fakeFetch({ 'https://bullpen.example/': { body: MENU_HTML } });
    const first = await scrapeMenu('https://bullpen.example/', { fetchImpl: impl });
    const previous = itemsFromText(menuSnapshotText(first));
    assert.ok(previous.length >= 4);

    const changedHtml = MENU_HTML.replace('R280', 'R320').replace('Veggie burger R120', 'Veggie burger R130');
    const secondFetch = fakeFetch({ 'https://bullpen.example/': { body: changedHtml } });
    const second = await scrapeMenu('https://bullpen.example/', {
      fetchImpl: secondFetch.impl,
      previousItems: previous,
    });

    assert.equal(second.diff.hasChanges, true);
    assert.deepEqual(
      second.diff.priceChanges.map((change) => [change.name, change.delta]).sort(),
      [
        ['Ribeye steak (300g)', 40],
        ['Veggie burger', 10],
      ].sort()
    );
    assert.deepEqual(second.diff.newItems, []);
    assert.deepEqual(second.diff.removedItems, []);
  });

  test('removals are reported when a dish disappears', async () => {
    const baseline = parseMenuItems(htmlToText(MENU_HTML));
    const without = MENU_HTML.replace('<li>Garlic bread &mdash; R45</li>', '');
    const { impl } = fakeFetch({ 'https://bullpen.example/': { body: without } });
    const result = await scrapeMenu('https://bullpen.example/', { fetchImpl: impl, previousItems: baseline });
    assert.deepEqual(result.diff.removedItems.map((i) => i.name), ['Garlic bread']);
    assert.equal(result.diff.hasChanges, true);
  });

  test('non-HTML, HTTP errors and internal URLs all fail loudly', async () => {
    const pdf = fakeFetch({ 'https://x.example/menu': { body: '%PDF-1.4', contentType: 'application/pdf' } });
    await assert.rejects(() => scrapeMenu('https://x.example/menu', { fetchImpl: pdf.impl }), /not HTML/);

    const broken = fakeFetch({ 'https://x.example/menu': { status: 502, body: 'bad gateway' } });
    await assert.rejects(() => scrapeMenu('https://x.example/menu', { fetchImpl: broken.impl }), /HTTP 502/);

    await assert.rejects(() => scrapeMenu('http://169.254.169.254/latest/meta-data/'), /not a public http/);
  });

  test('a page that already has prices is not re-fetched through a menu link', async () => {
    // The link sits in a block element, as a real nav does: inline anchors do
    // not break lines, and "Menu Steak" is not a dish.
    const landing = '<html><body><div><a href="/menu">Menu</a></div><p>Steak R180</p></body></html>';
    const { impl, urls } = fakeFetch({ 'https://x.example/': { body: landing } });
    const result = await scrapeMenu('https://x.example/', { fetchImpl: impl });
    assert.deepEqual(urls, ['https://x.example/']);
    assert.equal(result.menuUrl, 'https://x.example/');
    // The lone "Menu" line above the dish reads as a section heading — which
    // is what a bare word on its own line usually is.
    assert.deepEqual(result.items, [{ name: 'Steak', price: 180, category: 'Menu' }]);
  });

  test('a broken menu link degrades to the landing page instead of failing', async () => {
    const landing = '<html><body><h1>Hi</h1><div><a href="/menu">Menu</a></div></body></html>';
    const { impl, urls } = fakeFetch({
      'https://x.example/': { body: landing },
      // /menu is absent from the map, so the fake answers 404
    });
    const result = await scrapeMenu('https://x.example/', { fetchImpl: impl });
    assert.deepEqual(urls, ['https://x.example/', 'https://x.example/menu']);
    assert.equal(result.menuUrl, 'https://x.example/', 'the dead link is not recorded as the source');
    assert.deepEqual(result.items, []);
    assert.equal(result.priceRange, null);
    assert.equal(result.diff.hasChanges, false);
  });
});
