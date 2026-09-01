import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const PUBLIC = join(HERE, '..', '..', 'public');

/**
 * GATE UI-5 / UI-5B — landing page “The Closed Loop” rebuild, wiring checks.
 *
 * Copy authority: the owner-approved simple-English version (UI-5B), on top
 * of the UI-5 visual rebuild (light linen theme + warm restaurant
 * photography + “Example” badges on every illustrative number).
 *
 * These assertions pin the contract so a future refactor cannot silently
 * regress the owner’s approved narrative, the honesty rule, or the image
 * wiring.
 */
describe('GATE UI-5 — landing rebuild wiring', () => {
  const landing = readFileSync(join(APP, '(marketing)', 'landing-client.tsx'), 'utf8');

  test('hero carries the owner-approved simple-English copy', () => {
    assert.match(landing, /Full tables\. Even on Tuesdays\./);
    // JSX source wraps lines, so whitespace-tolerant patterns.
    assert.match(landing, /Flavourly answers your WhatsApp in 2–3 seconds/);
    assert.match(landing, /it\s+shows\s+you\s+the\s+money\s+it\s+made\s+you/);
    assert.match(landing, /No other tool does all this\. And proves it\./);
    assert.match(landing, /See it on your restaurant — 2 minutes/);
    assert.match(landing, /Start free for 14 days/);
  });

  test('the four trust chips are present', () => {
    assert.match(landing, /No app needed/);
    assert.match(landing, /POPIA safe/);
    assert.match(landing, /Pause anytime/);
    assert.match(landing, /Your number stays yours/);
  });

  test('the six pain → fix cards are present', () => {
    assert.match(landing, /I miss WhatsApps while I’m on the floor\./);
    assert.match(landing, /Answers in 2–3 seconds\. Day and night\./);
    assert.match(landing, /People book and don’t show\./);
    assert.match(landing, /Tuesdays are empty\./);
    assert.match(landing, /Customers come once, never again\./);
    assert.match(landing, /I don’t know what my competitors are doing\./);
    assert.match(landing, /I spend on ads and don’t know if it worked\./);
  });

  test('nearby invite + consent line are present', () => {
    assert.match(landing, /A customer who loves you walks past your door\./);
    assert.match(landing, /Only guests who joined your list and said yes\. POPIA safe\./);
  });

  test('test-before-you-spend card carries the PulseMap disclaimer', () => {
    assert.match(landing, /tests it on your customer types before you spend a Rand/);
    assert.match(landing, /Forecast only\. Real results are measured after launch\./);
  });

  test('the receipt shows exactly the four approved example Rands, labelled', () => {
    for (const amount of ['R11 000', 'R19 800', 'R3 750', 'R6 000', 'R40 550']) {
      assert.match(landing, new RegExp(amount.replace(' ', ' ')));
    }
    assert.match(landing, /Example numbers — your dashboard shows your real Rands\./);
    // Every Example badge is the same component, so counting usage is enough.
    const badges = landing.match(/<ExampleBadge/g)?.length ?? 0;
    assert.ok(badges >= 6, `expected at least 6 Example badges, found ${badges}`);
  });

  test('final CTA is the owner-approved deal sentence', () => {
    assert.match(landing, /Set your table in 5 minutes\./);
    assert.match(landing, /If Flavourly doesn’t pay for itself, the dashboard will tell you — that’s the deal\./);
  });

  test('light linen theme, not the old dark SaaS void', () => {
    assert.match(landing, /bg-\[#FFFBF5\]/);
    assert.doesNotMatch(landing, /bg-zinc-9[50]/);
    assert.doesNotMatch(landing, /bg-gradient-to-br from-purple/);
    // Display serif for headings, the restaurant voice.
    assert.match(landing, /font-display/);
  });

  test('all referenced landing images exist on disk', () => {
    const refs = Array.from(landing.matchAll(/\/images\/landing\/([a-z-]+\.jpg)/g)).map((m) => m[1]);
    assert.ok(refs.length >= 5, `expected >=5 landing images, found ${refs.length}`);
    for (const name of Array.from(new Set(refs))) {
      const p = join(PUBLIC, 'images', 'landing', name);
      assert.ok(existsSync(p), `missing image: public/images/landing/${name}`);
    }
  });

  test('every next/image declares explicit dimensions; hero photo is priority', () => {
    const images = Array.from(landing.matchAll(/<Image\b[\s\S]*?\/>/g)).map((m) => m[0]);
    assert.ok(images.length >= 6, `expected >=6 <Image> usages, found ${images.length}`);
    for (const img of images) {
      // Filled (responsive) images need `sizes`; fixed images need intrinsic
      // width + height. Either way the browser always knows the layout slot.
      const hasFillSizes = /\bfill\b/.test(img) && /\bsizes=/.test(img);
      const hasIntrinsic = /\bwidth=/.test(img) && /\bheight=/.test(img);
      assert.ok(
        hasFillSizes || hasIntrinsic,
        `<Image> without explicit dimensions:\n${img.slice(0, 140)}`,
      );
    }
    const hero = images.find((img) => img.includes('/images/landing/hero-dining-room.jpg'));
    assert.ok(hero, 'hero photo <Image> not found');
    assert.match(hero!, /\bpriority\b/, 'hero photo must be the priority (LCP) image');
    assert.match(hero!, /\bsizes="100vw"/, 'hero photo must declare sizes="100vw"');
  });

  test('CTA routes resolve to real app routes (no dead links)', () => {
    // Demo CTA → /sign-up (the branded-demo/trial entry); trial → Clerk flow.
    assert.match(landing, /href="\/sign-up"/);
    for (const route of ['/pricing', '/privacy', '/terms', '/dashboard']) {
      assert.match(landing, new RegExp(`href="${route}"`), `missing footer/nav link ${route}`);
      const exists =
        existsSync(join(APP, '(marketing)', route.slice(1), 'page.tsx')) ||
        existsSync(join(APP, '(app)', route.slice(1), 'page.tsx')) ||
        route === '/dashboard';
      assert.ok(exists, `route ${route} has no page file`);
    }
  });
});
