import crypto from 'crypto';

/**
 * Pure authorization decision for the cron-triggered routes (/api/cron/*).
 *
 * This is deliberately kept free of any Next.js imports so the security
 * boundary can be unit-tested directly, against the real implementation,
 * rather than through a mocked framework object. The request/response
 * adapter lives in ./auth.ts.
 *
 * Fails CLOSED:
 *   - CRON_SECRET unset on the server -> reject. An unset secret must never
 *     mean "accept anything". This previously returned null (allowing the
 *     request through with only a console warning), which left
 *     /api/cron/outbox, /api/cron/waitlist and /api/cron/daily-brief
 *     publicly callable by anyone who guessed the URL.
 *   - Missing / malformed Authorization header -> reject.
 *   - Wrong credential -> reject.
 *   - `Authorization: Bearer <CRON_SECRET>` -> allow.
 *
 * Query-string authentication (`?key=`, `?secret=`) is NOT accepted. Query
 * strings are recorded in CDN, proxy and platform access logs and leak via
 * the Referer header, so a secret placed there should be treated as
 * disclosed. Credentials must travel in the Authorization header only.
 */

/**
 * Constant-time string comparison.
 *
 * `===` on secrets short-circuits at the first differing byte, which leaks
 * the length of the matching prefix through response timing. crypto's
 * timingSafeEqual requires equal-length buffers, so both sides are hashed
 * to a fixed 32 bytes first — this compares the digests in constant time
 * without leaking the real secret's length.
 */
function safeEqual(a: string, b: string): boolean {
  const aHash = crypto.createHash('sha256').update(a).digest();
  const bHash = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

/**
 * @param authorizationHeader value of the incoming `Authorization` header
 * @param secret              value of process.env.CRON_SECRET
 */
export function isCronAuthorized(
  authorizationHeader: string | null | undefined,
  secret: string | undefined
): boolean {
  // Fail closed: no server-side secret configured means no request can be
  // authorized, ever.
  if (!secret) return false;

  if (typeof authorizationHeader !== 'string') return false;

  const prefix = 'Bearer ';
  if (!authorizationHeader.startsWith(prefix)) return false;

  const provided = authorizationHeader.slice(prefix.length);
  if (!provided) return false;

  return safeEqual(provided, secret);
}
