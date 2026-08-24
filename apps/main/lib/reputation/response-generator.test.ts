import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSpecifics,
  firstSpecific,
  generateResponse,
  parseThemesReply,
  createThemeCache,
  themeCacheKey,
  draftReviewResponse,
  type ReviewForResponse,
  type Theme,
} from './response-generator.ts';

function review(overrides: Partial<ReviewForResponse> = {}): ReviewForResponse {
  return {
    authorName: 'Thabo',
    rating: 5,
    text: 'Amazing evening!',
    sentiment: 'positive',
    ...overrides,
  };
}

describe('extractSpecifics (rule layer)', () => {
  test('finds dishes, staff and ambiance words independently', () => {
    const s = extractSpecifics('The ribs were incredible and our waiter was attentive, lovely vibe too');
    assert.deepEqual(s.dishes, ['ribs']);
    assert.deepEqual(s.staff, ['waiter']);
    assert.deepEqual(s.ambiance, ['vibe']);
  });

  test('is case-insensitive and collects multiples', () => {
    const s = extractSpecifics('Best PIZZA and pasta in Benoni, great view');
    assert.ok(s.dishes.includes('pizza'));
    assert.ok(s.dishes.includes('pasta'));
    assert.ok(s.ambiance.includes('view'));
  });

  test('word-boundary matching avoids substring false positives', () => {
    // "steakhouse" contains "steak" — fine — but "classic" must not count as
    // "lassi", and no lexicon word appears here at all:
    const s = extractSpecifics('Classic interlude, wonderful night');
    assert.deepEqual(s.dishes, []);
  });

  test('empty/null text yields empty specifics', () => {
    assert.deepEqual(extractSpecifics(null), { dishes: [], staff: [], ambiance: [] });
    assert.deepEqual(extractSpecifics(''), { dishes: [], staff: [], ambiance: [] });
    assert.deepEqual(extractSpecifics(undefined), { dishes: [], staff: [], ambiance: [] });
  });

  test('firstSpecific prefers dishes, then ambiance, then staff', () => {
    assert.equal(firstSpecific({ dishes: ['curry'], staff: ['chef'], ambiance: [] }), 'our curry');
    assert.equal(firstSpecific({ dishes: [], staff: [], ambiance: ['view'] }), 'the view');
    assert.equal(firstSpecific({ dishes: [], staff: ['manager'], ambiance: [] }), 'our manager');
    assert.equal(firstSpecific({ dishes: [], staff: [], ambiance: [] }), null);
  });
});

describe('generateResponse (templates per sentiment)', () => {
  test('positive: thanks the author and references the specific dish', () => {
    const text = generateResponse(
      review({ text: 'The ribs were fall-apart tender and the vibe was electric' })
    );
    assert.match(text, /^Thank you so much, Thabo!/);
    assert.match(text, /enjoyed our ribs/);
    assert.match(text, /welcoming you back soon/);
  });

  test('neutral: appreciates feedback without overthanking', () => {
    const text = generateResponse(review({ rating: 3, sentiment: 'neutral', text: 'Food fine, service slow' }));
    assert.match(text, /^Thank you for your feedback, Thabo\./);
    assert.match(text, /always looking to improve/);
    assert.match(text, /our service/); // staff word detected
  });

  test('negative: apologizes and offers the phone channel when provided', () => {
    const text = generateResponse(
      review({ rating: 1, sentiment: 'negative', text: 'Cold food, rude server' }),
      { contactPhone: '011 555 0100' }
    );
    assert.match(text, /sorry to hear about your experience, Thabo/);
    assert.match(text, /isn't the standard we strive for/);
    assert.match(text, /reach out to us directly at 011 555 0100/);
  });

  test('negative: falls back to email channel, then to no channel', () => {
    const email = generateResponse(review({ rating: 2, sentiment: 'negative', text: null }), {
      contactEmail: 'owner@flavourly.co.za',
    });
    assert.match(email, /at owner@flavourly\.co\.za/);

    const none = generateResponse(review({ rating: 2, sentiment: 'negative', text: null }));
    assert.match(none, /reach out to us directly directly/); // degrades gracefully
    assert.ok(!none.includes('at null'));
  });

  test('missing author name degrades to a safe greeting', () => {
    const text = generateResponse(review({ authorName: '', text: null }));
    assert.match(text, /Thank you so much, there!/);
  });

  test('positive with no specifics still reads naturally', () => {
    const text = generateResponse(review({ text: null }));
    assert.match(text, /thrilled you enjoyed your visit/);
  });
});

describe('parseThemesReply (LLM output hardening)', () => {
  test('accepts a JSON object with valid themes', () => {
    assert.deepEqual(parseThemesReply('{"themes": ["food", "service"]}'), ['food', 'service']);
  });

  test('accepts a pre-parsed object and drops invalid theme words', () => {
    assert.deepEqual(parseThemesReply({ themes: ['food', 'parking', 42] }), ['food']);
  });

  test('rejects garbage: null themes, non-arrays, invalid JSON, empty results', () => {
    assert.equal(parseThemesReply('{"themes": []}'), null);
    assert.equal(parseThemesReply('{"themes": "food"}'), null);
    assert.equal(parseThemesReply('not json at all'), null);
    assert.equal(parseThemesReply(null), null);
    assert.equal(parseThemesReply('{"themes": ["nonsense"]}'), null);
  });
});

describe('theme cache (24h TTL)', () => {
  const t0 = new Date('2026-08-20T08:00:00Z');
  const t23h = new Date(t0.getTime() + 23 * 60 * 60 * 1000);
  const t25h = new Date(t0.getTime() + 25 * 60 * 60 * 1000);

  test('caches hits and misses by review-text hash', () => {
    const cache = createThemeCache();
    cache.set('k1', ['food'], t0);
    assert.deepEqual(cache.get('k1', t23h), ['food']);
    assert.equal(cache.get('unknown', t0), undefined);
  });

  test('entries expire after the TTL (a miss, not a stale return)', () => {
    const cache = createThemeCache();
    cache.set('k1', ['food'], t0);
    assert.equal(cache.get('k1', t25h), undefined);
    // and the expired entry is dropped, not resurrected
    assert.equal(cache.get('k1', t23h), undefined);
  });

  test('null results are cached too (failed lookups do not retry-loop)', () => {
    const cache = createThemeCache();
    cache.set('k1', null, t0);
    assert.equal(cache.get('k1', t23h), null); // cached miss
    assert.equal(cache.get('k1', t25h), undefined); // expired -> fresh attempt
  });

  test('cache keys are content-addressed, not collision-prone', () => {
    assert.equal(themeCacheKey('review a') === themeCacheKey('review a'), true);
    assert.notEqual(themeCacheKey('review a'), themeCacheKey('review b'));
    assert.match(themeCacheKey('x'), /^[0-9a-f]{64}$/);
  });
});

describe('draftReviewResponse (rules-first pipeline)', () => {
  test('rule-extracted specifics are used without any LLM call', async () => {
    let llmCalls = 0;
    const draft = await draftReviewResponse(
      review({ text: 'The sushi was flawless' }),
      {},
      {
        classifier: async () => {
          llmCalls += 1;
          return ['food'];
        },
      }
    );
    assert.equal(llmCalls, 0); // rules short-circuited the classifier
    assert.match(draft, /sushi/);
  });

  test('LLM themes enrich the draft and are cached for 24h', async () => {
    const cache = createThemeCache();
    const now = new Date('2026-08-20T08:00:00Z');
    const text = 'We came for a birthday celebration and honestly the whole experience exceeded expectations';
    let calls = 0;
    const classifier = async (): Promise<Theme[] | null> => {
      calls += 1;
      return ['food', 'service'];
    };

    const one = await draftReviewResponse(review({ text }), {}, { classifier, cache, now });
    const two = await draftReviewResponse(review({ text }), {}, { classifier, cache, now });

    assert.equal(calls, 1); // second draft came from the cache
    assert.match(one, /detailed feedback about the food and the service/);
    assert.equal(one, two);
  });

  test('classifier failure degrades to the plain template without throwing', async () => {
    const draft = await draftReviewResponse(
      review({ rating: 1, sentiment: 'negative', text: 'A '.repeat(30) + 'disappointing visit overall' }),
      { contactPhone: '011 555 0100' },
      { classifier: async () => null, cache: createThemeCache(), now: new Date() }
    );
    assert.match(draft, /sorry to hear/);
    assert.match(draft, /011 555 0100/);
  });

  test('short reviews skip the LLM entirely (too little signal)', async () => {
    let calls = 0;
    const draft = await draftReviewResponse(review({ text: 'Nice' }), {}, {
      classifier: async () => {
        calls += 1;
        return ['food'];
      },
      cache: createThemeCache(),
      now: new Date(),
    });
    assert.equal(calls, 0);
    assert.match(draft, /Thank you so much/);
  });

  test('no classifier configured still drafts (deterministic path)', async () => {
    const draft = await draftReviewResponse(review({ text: null }));
    assert.match(draft, /Thank you so much, Thabo!/);
  });
});
