import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPromotionsInText,
  detectPromotions,
  promotionKey,
} from './promotion-detector.ts';

describe('detectPromotionsInText', () => {
  test('extracts the full sentence around each keyword family', () => {
    const text = [
      'Happy hour weekdays 16:00-18:00, half-price cocktails.',
      'Our steaks are grass-fed and aged 28 days.',
      '2-for-1 sushi Tuesdays at the counter.',
      'Show this voucher for a free dessert.',
    ].join('\n');
    const promotions = detectPromotionsInText(text);
    const sentences = promotions.map((p) => p.promotionText);

    assert.ok(sentences.some((s) => s.includes('Happy hour weekdays 16:00-18:00')));
    assert.ok(sentences.some((s) => s.includes('2-for-1 sushi Tuesdays')));
    assert.ok(sentences.some((s) => s.includes('voucher for a free dessert')));
    // The steak line has no promotion keyword and must not appear.
    assert.ok(!sentences.some((s) => s.includes('grass-fed')));
  });

  test('catches the common keyword families', () => {
    const text = [
      'Winter discount on all curries',
      'Buy one get one on burgers',
      '50% off wine on Wednesdays',
      'Kids eat free on Sundays',
      'Combo deal: burger, chips and a coke',
    ].join('\n');
    const keywords = detectPromotionsInText(text).map((p) => p.keyword);
    for (const expected of ['discount', 'buy one get one', '50% off', 'kids eat free', 'combo deal']) {
      assert.ok(
        keywords.some((k) => k.includes(expected) || expected.includes(k)),
        `missing keyword family: ${expected} (got ${keywords.join(', ')})`
      );
    }
  });

  test('no keywords means no promotions (zero false positives on prose)', () => {
    const text = 'Welcome to our restaurant. We serve breakfast, lunch and dinner with a full bar.';
    assert.deepEqual(detectPromotionsInText(text), []);
  });

  test('duplicate phrasings collapse to one detection via the key', () => {
    const text = 'Happy hour weekdays 16:00-18:00. Happy hour weekdays 16:00-18:00';
    const promotions = detectPromotionsInText(text);
    assert.equal(promotions.length, 1);
  });

  test('long paragraphs mentioning a keyword are ignored', () => {
    const paragraph =
      'Our winter special menu is a carefully curated journey through the Cape winelands, featuring slow-roasted lamb, ' +
      'locally sourced seafood and a dessert tasting plate prepared by our award-winning pastry team, ' +
      'available every evening from May through August with optional wine pairing by our sommelier.';
    assert.ok(paragraph.length > 220, 'fixture must exceed the sentence-length threshold');
    assert.deepEqual(detectPromotionsInText(paragraph), []);
  });

  test('empty text is an empty list', () => {
    assert.deepEqual(detectPromotionsInText(''), []);
  });
});

describe('promotionKey (dedup fingerprint)', () => {
  test('stable across trivial formatting differences', () => {
    assert.equal(promotionKey('Happy Hour Weekdays 16:00-18:00!'), promotionKey('happy  hour weekdays 16 00 18 00'));
  });

  test('different wording produces a different key', () => {
    assert.notEqual(promotionKey('Half price pizza Mondays'), promotionKey('Half price pizza Tuesdays'));
  });

  test('caps length at 120 chars', () => {
    const long = 'a '.repeat(200);
    assert.ok(promotionKey(long).length <= 120);
  });
});

describe('detectPromotions (injectable transport)', () => {
  test('happy path over HTML', async () => {
    const html = '<html><body><p>Happy hour every weekday from 4pm!</p><p>About us: family run since 1998.</p></body></html>';
    const fetchImpl = (async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const promotions = await detectPromotions('https://x.example', { fetchImpl });
    assert.equal(promotions.length, 1);
    assert.match(promotions[0].promotionText, /Happy hour every weekday from 4pm/);
  });

  test('script content is not scanned', async () => {
    const html = '<html><script>var msg = "special discount inside script";</script><p>Pure prose here.</p></html>';
    const fetchImpl = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
    assert.deepEqual(await detectPromotions('https://x.example', { fetchImpl }), []);
  });

  test('non-200 throws so the cron can count the failure', async () => {
    const fetchImpl = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await assert.rejects(detectPromotions('https://x.example', { fetchImpl }), /500/);
  });
});
