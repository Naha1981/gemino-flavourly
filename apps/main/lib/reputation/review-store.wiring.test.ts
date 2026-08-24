import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'review-store.ts');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

describe('Review store wiring (Gate #11 mutation + isolation checks)', () => {
  const src = code(STORE);

  test('upsertReview keys on Google review_id with tenant-scoped look-before-write', () => {
    const body = from(src, 'export async function upsertReview');
    assert.match(body, /insert\(googleReviews\)/);
    assert.match(body, /eq\(googleReviews\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(googleReviews\.reviewId,\s*review\.reviewId\)/);
    // The race between the existence check and the INSERT is still safe:
    // the unique review_id constraint backs it up (23505 -> update path).
    assert.match(body, /23505/);
  });

  test('re-fetching never clobbers the owner response columns', () => {
    // Bounded to the upsertReview function only: slicing to end-of-file would
    // drag the draft functions (which legitimately mention responseText) in.
    const fn = from(src, 'export async function upsertReview').split('\n\nexport ')[0];
    const body = from(fn, 'const googleOwned = {');
    // The refresh set must contain the Google-owned fields…
    for (const field of ['authorName', 'rating', 'text', 'time', 'sentiment', 'googlePlaceId']) {
      assert.match(body, new RegExp(`\\b${field}\\b`), `googleOwned is missing ${field}`);
    }
    // …and must NOT touch the response draft / sent stamp.
    assert.doesNotMatch(body, /responseText/);
    assert.doesNotMatch(body, /responseSentAt/);
  });

  test('every review read is tenant-scoped', () => {
    for (const fn of [
      'export async function getReviews',
      'export async function countReviews',
      'export async function getReviewByGoogleId',
      'export async function countByRating',
      'export async function getAverageRating',
      'export async function sentimentBreakdown',
    ]) {
      assert.match(from(src, fn), /eq\(googleReviews\.tenantId,\s*tenantId\)/, `${fn} is not tenant-scoped`);
    }
  });

  test('getReviewByGoogleId also filters by review id (no cross-tenant id probing)', () => {
    const body = from(src, 'export async function getReviewByGoogleId');
    assert.match(body, /eq\(googleReviews\.reviewId,\s*reviewId\)/);
  });

  test('every response-draft mutation is tenant-scoped', () => {
    for (const fn of [
      'export async function updateResponseDraft',
      'export async function setResponseDraftIfAbsent',
      'export async function markResponseSent',
    ]) {
      const body = from(src, fn);
      assert.match(body, /eq\(googleReviews\.tenantId,\s*tenantId\)/, `${fn} is not tenant-scoped`);
      assert.match(body, /eq\(googleReviews\.reviewId,\s*reviewId\)/, `${fn} does not pin the review`);
    }
  });

  test('setResponseDraftIfAbsent refuses to overwrite an existing draft or sent stamp', () => {
    const body = from(src, 'export async function setResponseDraftIfAbsent');
    assert.match(body, /googleReviews\.responseText\}\s*IS NULL/);
    assert.match(body, /googleReviews\.responseSentAt\}\s*IS NULL/);
  });

  test('place config save upserts one row per tenant and encrypts the key', () => {
    const body = from(src, 'export async function savePlaceConfig');
    assert.match(body, /onConflictDoUpdate\(\{\s*target:\s*googlePlacesConfig\.tenantId/);
    assert.match(body, /encryptSecret\(apiKey\)/);
  });

  test('getPlaceConfig is tenant-scoped', () => {
    assert.match(from(src, 'export async function getPlaceConfig'), /eq\(googlePlacesConfig\.tenantId,\s*tenantId\)/);
  });

  test('the serialized config never echoes the API key', () => {
    const body = from(src, 'export function serializePlaceConfig');
    assert.doesNotMatch(body, /decryptSecret\(row\.apiKeyEncrypted\)\s*\}/);
    assert.match(body, /has_api_key/);
    const full = src;
    // No serializer may return the raw ciphertext either.
    assert.doesNotMatch(full, /api_key:\s*row\.apiKeyEncrypted/);
  });

  test('cron config listing decrypts keys internally and never returns ciphertext', () => {
    const body = from(src, 'export async function findAllPlaceConfigs');
    assert.match(body, /decryptSecret\(row\.apiKeyEncrypted\)/);
    assert.doesNotMatch(body, /apiKeyEncrypted:\s*row\.apiKeyEncrypted/);
  });
});
