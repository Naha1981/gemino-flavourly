import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROMOTION_KEYWORDS,
  SUPPORT_SIGNAL,
  detectPromotions,
  detectPromotionsInText,
  newPromotions,
  normalizePromotion,
  websiteSource,
} from './promotion-detector.ts';

function fakeFetch(routes: Record<string, { status?: number; body: string; contentType?: string }>) {
  const urls: string[] = [];
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    const next = routes[url] ?? { status: 404, body: 'not found' };
    return new Response(next.body, {
      status: next.status ?? 200,
      headers: { 'Content-Type': next.contentType ?? 'text/html; charset=utf-8' },
    });
  };
  return { impl: impl as unknown as typeof fetch, urls };
}

describe('promotion detector: keyword rules', () => {
  test('strong offer phrases are detected with no extra signal', () => {
    const found = detectPromotionsInText(
      [
        'Happy Hour 16:00 - 18:00',
        '2-for-1 on cocktails every Tuesday',
        'Buy one get one free burgers',
        'Kids eat free on Sundays',
        'Early bird: arrive before 18:00',
        'All you can eat ribs, Thursdays',
      ].join('\n')
    );

    const keywords = found.map((item) => item.keyword);
    for (const expected of ['happy hour', '2-for-1', 'buy one get one', 'kids eat free', 'early bird', 'all you can eat']) {
      assert.ok(keywords.includes(expected), `missing ${expected} in ${keywords.join(', ')}`);
    }
  });

  test('percentages and half-price offers are strong too', () => {
    const found = detectPromotionsInText('Get 20% off all bottles\nWine at half-price on Wednesdays');
    assert.deepEqual(found.map((item) => item.keyword), ['% off', 'half price']);
    assert.match(found[0].promotionText, /20% off/);
  });

  test('weak keywords need a price, percentage or urgency signal', () => {
    const found = detectPromotionsInText(
      [
        "Chef's special: pan-seared duck with plum sauce", // no signal -> not a promotion
        'Daily special R99', // R99 -> promotion
        'We can deal with most dietary requirements', // no signal -> not a promotion
        'Weekend deal: two mains for R180', // price -> promotion
        'Ask about our offers', // no signal -> not a promotion
        'Limited time offer - free dessert', // 'free' + 'limited' -> promotion
      ].join('\n')
    );

    const texts = found.map((item) => item.promotionText);
    assert.equal(texts.length, 3, texts.join(' || '));
    assert.ok(texts.includes('Daily special R99'));
    assert.ok(texts.includes('Weekend deal: two mains for R180'));
    assert.ok(texts.includes('Limited time offer - free dessert'));
  });

  test('the support-signal pattern is what the weak rule relies on', () => {
    assert.equal(SUPPORT_SIGNAL.test('R99'), true);
    assert.equal(SUPPORT_SIGNAL.test('20%'), true);
    assert.equal(SUPPORT_SIGNAL.test('save R20'), true);
    assert.equal(SUPPORT_SIGNAL.test('pan-seared duck with plum sauce'), false);
  });

  test('one detection per line, however many keywords it contains', () => {
    const found = detectPromotionsInText('Happy hour special deal: 2-for-1 cocktails');
    assert.equal(found.length, 1);
    assert.equal(found[0].keyword, 'happy hour', 'the first (most specific) keyword wins');
  });

  test('duplicate offers are reported once', () => {
    const found = detectPromotionsInText('Happy hour 16:00-18:00\nHAPPY HOUR 16:00-18:00\nHappy  hour  16:00-18:00');
    assert.equal(found.length, 1);
  });

  test('an over-long line is scanned sentence by sentence', () => {
    const longLine =
      'We are proud to serve the finest cuts in the city, sourced from local farms and aged in house for twenty eight days. ' +
      'This month only: 25% off every bottle from our reserve list. ' +
      'Reservations recommended for parties larger than six guests.';
    const found = detectPromotionsInText(longLine);
    assert.equal(found.length, 1);
    assert.equal(found[0].keyword, '% off');
    assert.ok(found[0].promotionText.length < longLine.length, 'only the sentence is reported, not the paragraph');
  });

  test('promotions are capped so a keyword-stuffed page cannot bury real offers', () => {
    const text = Array.from({ length: 40 }, (_unused, i) => `Happy hour ${i}`).join('\n');
    assert.equal(detectPromotionsInText(text).length, 20);
    assert.equal(detectPromotionsInText(text, { maxPromotions: 3 }).length, 3);
  });

  test('context carries the neighbouring lines for the dashboard', () => {
    const found = detectPromotionsInText('Starters\nSoup R65\nHappy hour 16:00-18:00\nMains\nSteak R280');
    assert.equal(found.length, 1);
    assert.equal(found[0].context, 'Soup R65 | Happy hour 16:00-18:00 | Mains');
  });

  test('plain menu text produces no promotions', () => {
    const found = detectPromotionsInText('Starters\nSoup of the day R65\nMains\nRibeye steak R280\nDessert\nMalva pudding R55');
    assert.deepEqual(found, []);
  });

  test('every keyword entry is a usable rule', () => {
    for (const entry of PROMOTION_KEYWORDS) {
      assert.ok(entry.keyword.length > 0);
      assert.ok(entry.pattern instanceof RegExp);
      assert.equal(typeof entry.strong, 'boolean');
    }
  });
});

describe('promotion detector: identity and dedupe', () => {
  test('normalization ignores case, punctuation and accents', () => {
    assert.equal(normalizePromotion('  Happy   Hour — 16:00!  '), 'happy hour 16 00');
    assert.equal(normalizePromotion('20% OFF all Bottles'), normalizePromotion('20% off ALL bottles'));
  });

  test('newPromotions filters out offers already stored', () => {
    const detected = [
      { promotionText: 'Happy hour 16:00-18:00', keyword: 'happy hour', source: 'website:a.example', context: '' },
      { promotionText: 'Kids eat free Sundays', keyword: 'kids eat free', source: 'website:a.example', context: '' },
    ];
    const stored = [{ promotionText: 'HAPPY HOUR 16:00 - 18:00' }];
    const fresh = newPromotions(detected, stored);
    assert.deepEqual(fresh.map((item) => item.keyword), ['kids eat free']);
  });

  test('with nothing stored, everything is new', () => {
    const detected = [{ promotionText: 'Half price wine', keyword: 'half price', source: null, context: '' }];
    assert.equal(newPromotions(detected, []).length, 1);
  });

  test('source labels are the website host', () => {
    assert.equal(websiteSource('https://bullpen.example/menu?x=1'), 'website:bullpen.example');
    assert.equal(websiteSource('not a url'), null);
  });
});

describe('promotion detector: detectPromotions', () => {
  const HTML = `
  <html><body>
    <h1>The Bull Pen</h1>
    <div class="banner">HAPPY HOUR: 2-for-1 cocktails 16:00-18:00</div>
    <p>Soup of the day R65</p>
    <p>This month: 25% off every bottle of wine</p>
    <script>var promo = "ignore me R999";</script>
  </body></html>`;

  test('scans a website and labels the source', async () => {
    const { impl, urls } = fakeFetch({ 'https://bullpen.example/': { body: HTML } });
    const found = await detectPromotions('https://bullpen.example/', { fetchImpl: impl });

    assert.deepEqual(urls, ['https://bullpen.example/']);
    const keywords = found.map((item) => item.keyword);
    assert.ok(keywords.includes('happy hour'), keywords.join(', '));
    assert.ok(keywords.includes('% off'), keywords.join(', '));
    for (const item of found) assert.equal(item.source, 'website:bullpen.example');
  });

  test('a page with no offers returns an empty list, not an error', async () => {
    const { impl } = fakeFetch({
      'https://bullpen.example/': { body: '<p>Soup R65</p><p>Steak R280</p>' },
    });
    assert.deepEqual(await detectPromotions('https://bullpen.example/', { fetchImpl: impl }), []);
  });

  test('fetch failures and internal URLs throw so the cron can count them', async () => {
    const down = fakeFetch({ 'https://bullpen.example/': { status: 503, body: 'down' } });
    await assert.rejects(() => detectPromotions('https://bullpen.example/', { fetchImpl: down.impl }), /HTTP 503/);

    await assert.rejects(() => detectPromotions('http://10.0.0.5/'), /not a public http/);
  });
});
