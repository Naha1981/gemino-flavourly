import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..', '..', 'app', 'api', 'reputation');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function requireFile(rel: string): string {
  const full = join(API_DIR, rel);
  assert.ok(existsSync(full), `missing expected route file: ${rel}`);
  return full;
}

function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

const ROUTES = [
  'reviews/route.ts',
  'reviews/stats/route.ts',
  'reviews/[review_id]/route.ts',
  'reviews/[review_id]/send/route.ts',
  'reviews/[review_id]/regenerate/route.ts',
];

describe('reviews API wiring (Gate #11-#12)', () => {
  test('all five review routes exist', () => {
    for (const rel of ROUTES) requireFile(rel);
  });

  test('every route authenticates the tenant before touching the store', () => {
    for (const rel of ROUTES) {
      const src = code(requireFile(rel));
      assert.match(src, /getOrCreateTenant\(\)/, `${rel} does not resolve the tenant`);
      const unauthorizedAt = src.indexOf('Unauthorized');
      const storeAt = src.search(/(?:getReviews|countReviews|getAverageRating|countByRating|sentimentBreakdown|getReviewByGoogleId|updateResponseDraft|markResponseSent)\(/);
      assert.ok(unauthorizedAt > -1, `${rel} has no Unauthorized guard`);
      if (storeAt > -1) {
        assert.ok(unauthorizedAt < storeAt, `${rel} touches the store before the auth check`);
      }
    }
  });

  test('every route returns 401 when no tenant resolves', () => {
    for (const rel of ROUTES) {
      assert.match(code(requireFile(rel)), /status:\s*401/, `${rel} does not 401`);
    }
  });

  test('mutations pin BOTH the tenant and the review id', () => {
    for (const rel of ['reviews/[review_id]/route.ts', 'reviews/[review_id]/send/route.ts']) {
      const src = code(requireFile(rel));
      assert.match(src, /tenant\.id,\s*params\.review_id/, `${rel} must scope mutations by tenant.id AND review_id`);
    }
  });

  test('regenerate replaces the draft but refuses sent reviews (409)', () => {
    const src = code(requireFile('reviews/[review_id]/regenerate/route.ts'));
    assert.match(src, /responseSentAt/);
    assert.match(src, /status:\s*409/);
    assert.match(src, /draftReviewResponse/);
  });

  test('send refuses to mark a draftless review as sent', () => {
    const src = code(requireFile('reviews/[review_id]/send/route.ts'));
    assert.match(src, /No response drafted yet/);
    assert.match(src, /status:\s*400/);
  });

  test('list filters are validated against the enum/domain, never passed raw', () => {
    const src = code(requireFile('reviews/route.ts'));
    assert.match(src, /ratingParam >= 1 && ratingParam <= 5/);
    assert.match(src, /sentimentParam === 'positive' \|\| sentimentParam === 'neutral' \|\| sentimentParam === 'negative'/);
  });
});
