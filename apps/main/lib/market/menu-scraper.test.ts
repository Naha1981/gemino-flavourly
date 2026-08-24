import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  htmlToText,
  parseMenuItems,
  summarizePriceRange,
  fetchWebsiteText,
  scrapeMenu,
  compareMenus,
  type MenuItem,
} from './menu-scraper.ts';

describe('htmlToText', () => {
  test('strips script/style, converts breaks and blocks to lines', () => {
    const html = [
      '<html><body>',
      '<script>var x = "R99";</script>',
      '<style>.price { content: "R1" }</style>',
      '<h1>Our Menu</h1>',
      '<p>Wood-fired pizza R95</p><br>',
      '<div>Rib platter  R220.00</div>',
      '<tr><td>Bunny chow</td><td>R85,50</td></tr>',
      '</body></html>',
    ].join('');
    const text = htmlToText(html);
    assert.ok(!text.includes('var x'), 'script content leaked');
    assert.ok(!text.includes('.price'), 'style content leaked');
    assert.ok(text.includes('Wood-fired pizza R95'));
    assert.ok(text.includes('Rib platter R220.00'));
    assert.ok(text.includes('Bunny chow R85,50'));
  });

  test('decodes common entities', () => {
    const text = htmlToText('<p>Fish &amp; chips&nbsp;R75</p>');
    assert.match(text, /Fish & chips R75/);
  });
});

describe('parseMenuItems (SA price formats)', () => {
  test('parses R95, R 95, R95.00 and R95,50 forms into cents', () => {
    const items = parseMenuItems([
      'Wood-fired pizza R95',
      'Rib platter R 220',
      'Cape Malay curry R110.50',
      'Bunny chow R85,50',
    ].join('\n'));
    assert.deepEqual(items, [
      { name: 'Wood-fired pizza', priceCents: 9500 },
      { name: 'Rib platter', priceCents: 22000 },
      { name: 'Cape Malay curry', priceCents: 11050 },
      { name: 'Bunny chow', priceCents: 8550 },
    ]);
  });

  test('ignores prose paragraphs and bare prices', () => {
    const items = parseMenuItems(
      [
        'Join us this winter for a feast you will never forget, with dishes starting from just R99 per person and live music every Friday evening', // too long
        'R45', // bare price, no item
        'All you can eat sushi R349',
      ].join('\n')
    );
    assert.deepEqual(items, [{ name: 'All you can eat sushi', priceCents: 34900 }]);
  });

  test('ignores foreign currency symbols and rand mentions without prices', () => {
    const items = parseMenuItems(['Pizza $12', 'Ask about our winter specials', 'Coffee R'].join('\n'));
    assert.deepEqual(items, []);
  });
});

describe('summarizePriceRange', () => {
  test('min-max summary with "per person" wording', () => {
    const items: MenuItem[] = [
      { name: 'a', priceCents: 9500 },
      { name: 'b', priceCents: 22000 },
      { name: 'c', priceCents: 15000 },
    ];
    assert.equal(summarizePriceRange(items), 'R95-R220 per person');
  });

  test('single price collapses to a flat statement; empty is null', () => {
    assert.equal(summarizePriceRange([{ name: 'a', priceCents: 7500 }]), 'R75 per person');
    assert.equal(summarizePriceRange([]), null);
  });
});

describe('fetchWebsiteText + scrapeMenu (injectable transport)', () => {
  const MENU_HTML = [
    '<html><body><h1>Menu</h1>',
    '<p>Peri-peri chicken R120</p>',
    '<p>Half rack ribs R185.00</p>',
    '<p>Haloumi starter R75</p>',
    '</body></html>',
  ].join('');

  test('scrapeMenu returns text, structured items and price range', async () => {
    const fetchImpl = (async () =>
      new Response(MENU_HTML, { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const menu = await scrapeMenu('https://bullpen.example/menu', { fetchImpl });

    assert.equal(menu.menuUrl, 'https://bullpen.example/menu');
    assert.equal(menu.items.length, 3);
    assert.deepEqual(menu.items[0], { name: 'Peri-peri chicken', priceCents: 12000 });
    assert.equal(menu.priceRange, 'R75-R185 per person');
    assert.ok(menu.menuText.includes('Peri-peri chicken'));
  });

  test('non-200 responses throw so the cron can count the failure', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await assert.rejects(fetchWebsiteText('https://x.example', { fetchImpl }), /404/);
    await assert.rejects(scrapeMenu('https://x.example', { fetchImpl }), /404/);
  });
});

describe('compareMenus (pure diff)', () => {
  const prev: MenuItem[] = [
    { name: 'Peri-peri chicken', priceCents: 12000 },
    { name: 'Half rack ribs', priceCents: 18500 },
    { name: 'Old special', priceCents: 9900 },
  ];
  const next: MenuItem[] = [
    { name: 'Peri-peri chicken', priceCents: 13500 }, // price change
    { name: 'Half rack ribs', priceCents: 18500 }, // unchanged
    { name: 'New dessert', priceCents: 6500 }, // added
    // 'Old special' gone
  ];

  test('reports additions, removals and price changes', () => {
    const diff = compareMenus(prev, next);
    assert.equal(diff.hasChanges, true);
    assert.deepEqual(diff.newItems, [{ name: 'New dessert', priceCents: 6500 }]);
    assert.deepEqual(diff.removedItems, [{ name: 'Old special', priceCents: 9900 }]);
    assert.deepEqual(diff.priceChanges, [
      { name: 'Peri-peri chicken', fromCents: 12000, toCents: 13500 },
    ]);
  });

  test('identical menus have no changes', () => {
    const diff = compareMenus(prev, prev);
    assert.equal(diff.hasChanges, false);
    assert.deepEqual(diff.newItems, []);
    assert.deepEqual(diff.removedItems, []);
    assert.deepEqual(diff.priceChanges, []);
  });

  test('name matching is case/whitespace insensitive but exact otherwise', () => {
    const diff = compareMenus(
      [{ name: ' peri-peri  chicken ', priceCents: 12000 }],
      [{ name: 'Peri-Peri Chicken', priceCents: 12000 }]
    );
    assert.equal(diff.hasChanges, false);
  });

  test('empty vs empty is no change (never invents a diff)', () => {
    assert.equal(compareMenus([], []).hasChanges, false);
  });
});
