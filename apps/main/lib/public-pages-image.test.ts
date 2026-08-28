import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, '..');

function src(rel: string): string {
  const p = join(MAIN, rel);
  assert.ok(existsSync(p), `missing file: ${rel}`);
  return readFileSync(p, 'utf8');
}

/**
 * Regression test for GATE V2: public pages must not use raw <img> for logo
 * because Next.js lint rule @next/next/no-img-element warns and loses
 * automatic optimization. They must use next/image.
 *
 * Failing-first: before fix, these files contain <img src="/logo.png">.
 * After fix, they import Image from next/image and use <Image ...>.
 */
const PUBLIC_PAGES = [
  'app/landing-client.tsx',
  'app/pricing/page.tsx',
  'app/privacy/page.tsx',
  'app/terms/page.tsx',
];

describe('GATE V2 — public pages use next/image not raw <img>', () => {
  for (const rel of PUBLIC_PAGES) {
    test(`${rel} does not contain raw <img src="/logo.png">`, () => {
      const content = src(rel);
      // Strip eslint-disable comments — they were used for other img cases
      // (brand logo dynamic URL) and must not hide this specific static logo.
      const hasRawImg = /<img\s+[^>]*src=\"\/logo\.png\"/.test(content);
      assert.equal(hasRawImg, false, `${rel} still uses raw <img src="/logo.png"> — must use next/image`);
    });

    test(`${rel} imports Image from next/image`, () => {
      const content = src(rel);
      const importsImage = /from\s+['\"]next\/image['\"]/.test(content) || /import\s+Image\s+from/.test(content);
      assert.equal(importsImage, true, `${rel} must import Image from next/image`);
    });

    test(`${rel} uses <Image` , () => {
      const content = src(rel);
      const usesImage = /<Image\s+/.test(content);
      assert.equal(usesImage, true, `${rel} must use <Image component`);
    });
  }

  test('no other public pages reintroduce raw logo img', () => {
    // Ensure the 4 pages are the only ones we care about, but also ensure
    // the whole app folder doesn't have stray <img src="/logo.png"> outside
    // of allowed dynamic cases (claim page dynamic logoUrl is allowed and
    // has eslint-disable).
    const allowedRawDynamic = [
      'app/claim/[token]/page.tsx', // dynamic logoUrl, has eslint-disable
      'app/dashboard/whatsapp/page.tsx', // QR code canvas fallback, has eslint-disable
    ];
    // This test just ensures our 4 pages are clean; broader scan is lint.
    for (const rel of PUBLIC_PAGES) {
      const content = src(rel);
      assert.doesNotMatch(content, /eslint-disable-next-line.*no-img-element/, `${rel} should not need eslint-disable for static logo`);
    }
  });
});
