import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublicPath } from '../auth/route-guard-core.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, '..', '..');
const RESPONDER = join(MAIN, 'lib', 'ai', 'responder.ts');
const STORE = join(MAIN, 'lib', 'customer', 'reward-claim-store.ts');
const GEO_ROUTE = join(MAIN, 'app', 'api', 'loyalty', 'geo-claim', '[token]', 'route.ts');
const VISIT_ROUTE = join(MAIN, 'app', 'api', 'loyalty', 'complete-visit', 'route.ts');
const EXPIRY_CRON = join(MAIN, 'app', 'api', 'cron', 'reward-expiry', 'route.ts');
const SCHEMA = join(MAIN, 'lib', 'db', 'schema.ts');
const MIGRATE_DDL = join(MAIN, 'lib', 'db', 'migrate-ddl.ts');
const DDL_SQL = join(MAIN, 'drizzle', '0021_loyalty_gps_redemption.sql');

function code(path: string): string {
  assert.ok(existsSync(path), `missing file: ${path}`);
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/{\/\*[\s\S]*?\*\/}/g, '');
}

/**
 * O1 — wiring tests: the seams between responder, store, routes, schema and
 * the public-route allowlist. Source-text assertions per the repo's wiring
 * convention (see birthday.wiring.test.ts); behaviour is pinned by the pure
 * unit tests in reward-claim.test.ts.
 */
describe('O1 — responder dispatches loyalty keywords before the AI concierge', () => {
  const src = code(RESPONDER);

  test('JOIN is exact-match only (does not swallow "join waitlist")', () => {
    assert.match(src, /lower === 'join' \|\| lower === 'join loyalty'/);
    assert.doesNotMatch(src, /lower\.startsWith\('join'\)/);
  });

  test('REDEEM reaches the store and replies with the geo-claim link', () => {
    assert.match(src, /createPendingRewardEvent\(/);
    assert.match(src, /buildGeoClaimUrl\(/);
    assert.match(src, /REWARD_EVENT_TTL_MINUTES/);
  });

  test('JOIN awards the idempotent welcome bonus', () => {
    assert.match(src, /awardWelcomeBonusOnce\(/);
  });

  test('loyalty handlers sit BEFORE the Groq/Gemini AI fallback', () => {
    const joinAt = src.indexOf("lower === 'join'");
    const redeemAt = src.indexOf("lower === 'redeem'");
    const aiAt = src.indexOf('api.groq.com');
    assert.ok(joinAt > -1, 'JOIN handler missing');
    assert.ok(redeemAt > -1, 'REDEEM handler missing');
    assert.ok(aiAt > -1, 'AI fallback missing');
    assert.ok(joinAt < aiAt, 'JOIN must precede the AI fallback');
    assert.ok(redeemAt < aiAt, 'REDEEM must precede the AI fallback');
  });

  test('loyalty handlers sit AFTER the opt-out/opt-in and billing gates', () => {
    const optOutAt = src.indexOf('isOptOutMessage(text)');
    const billingAt = src.indexOf('decideBillingGate(');
    const joinAt = src.indexOf("lower === 'join'");
    assert.ok(optOutAt > -1 && optOutAt < joinAt, 'POPIA opt-out must run first');
    assert.ok(billingAt > -1 && billingAt < joinAt, 'billing gate must run first');
  });
});

describe('O1 — store: money safety seams', () => {
  const src = code(STORE);

  test('welcome bonus is exactly-once via the ref_id unique index', () => {
    assert.match(src, /onConflictDoNothing\(\{\s*target: loyaltyTransactions\.refId\s*\}\)/);
    assert.match(src, /`welcome:\$\{contactId\}`/);
  });

  test('visit earn is exactly-once per reservation', () => {
    assert.match(src, /`visit:\$\{reservation\.id\}`/);
  });

  test('verified redemption deducts with a ref_id and can never go negative', () => {
    assert.match(src, /GREATEST\(\$\{contacts\.loyaltyPoints\} - \$\{event\.pointsCost\}, 0\)/);
    assert.match(src, /`redeem:\$\{event\.id\}`/);
  });

  test('the pending→final flip is atomic (guarded WHERE status = pending)', () => {
    assert.ok(
      (src.match(/eq\(rewardEvents\.status, 'pending'\)/g) ?? []).length >= 4,
      'status-guarded transitions must appear for reject/insufficient/verify/lazy-expiry'
    );
  });

  test('single-use: too_far finalises the event as rejected', () => {
    assert.match(src, /status: 'rejected'/);
    assert.match(src, /rejectionReason: 'too_far'/);
  });

  test('balance is re-checked at verify time (points may have moved)', () => {
    assert.match(src, /balance < event\.pointsCost/);
    assert.match(src, /rejectionReason: 'insufficient_points'/);
  });

  test('supersede: at most one live claim per contact', () => {
    assert.match(src, /'superseded'/);
  });

  test('complete-visit is tenant-scoped', () => {
    assert.match(src, /eq\(reservations\.tenantId, input\.tenantId\)/);
  });
});

describe('O1 — routes', () => {
  test('geo-claim POST route + token validation exists', () => {
    const src = code(GEO_ROUTE);
    assert.match(src, /verifyRewardEventWithLocation\(/);
    assert.match(src, /export async function POST/);
    assert.match(src, /Invalid coordinates/);
    // Fail closed on internal error.
    assert.match(src, /console\.error\('\[geo-claim\]/);
  });

  test('complete-visit is behind tenant auth (401 without a tenant)', () => {
    const src = code(VISIT_ROUTE);
    assert.match(src, /getOrCreateTenant\(\)/);
    assert.match(src, /status: 401/);
    assert.match(src, /completeVisitAndEarn\(/);
  });

  test('reward-expiry cron is guarded by assertCronAuthorized', () => {
    const src = code(EXPIRY_CRON);
    assert.match(src, /assertCronAuthorized\(req\)/);
    assert.match(src, /expireStaleRewardEvents\(/);
  });
});

describe('O1 — public-route allowlist', () => {
  test('the guest geo-claim page renders signed-out', () => {
    assert.equal(isPublicPath('/geo-claim/abc123'), true);
  });

  test('the guest geo-claim API is public (token is the credential)', () => {
    assert.equal(isPublicPath('/api/loyalty/geo-claim/abc123'), true);
  });

  test('the staff complete-visit API stays behind auth', () => {
    assert.equal(isPublicPath('/api/loyalty/complete-visit'), false);
  });

  test('the route guard source carries the scoped public prefix', () => {
    const src = readFileSync(join(MAIN, 'lib', 'auth', 'route-guard-core.ts'), 'utf8');
    assert.match(src, /'\/geo-claim\/'/);
    assert.match(src, /'\/api\/loyalty\/geo-claim'/);
    assert.doesNotMatch(src, /'\/api\/loyalty'/);
  });
});

describe('O1 — schema parity', () => {
  const schemaSrc = readFileSync(SCHEMA, 'utf8');

  test('reward_events table + status enum + GPS columns declared', () => {
    assert.match(schemaSrc, /pgTable\(\s*'reward_events'/);
    assert.match(schemaSrc, /claimToken: text\('claim_token'\)/);
    assert.match(schemaSrc, /distanceM: integer\('distance_m'\)/);
    assert.match(
      schemaSrc,
      /enum: \['pending', 'verified', 'rejected', 'expired'\]/
    );
  });

  test('loyalty_transactions carries the ref_id idempotency key', () => {
    assert.match(schemaSrc, /refId: text\('ref_id'\)/);
    assert.match(schemaSrc, /loyalty_transactions_ref_id_uniq/);
  });

  test('drizzle migration 0021 mirrors the runtime DDL (both create reward_events)', () => {
    const sql = readFileSync(DDL_SQL, 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS reward_events/);
    assert.match(sql, /loyalty_transactions ADD COLUMN IF NOT EXISTS ref_id/);
    const ddl = readFileSync(MIGRATE_DDL, 'utf8');
    assert.match(ddl, /reward_events/);
    assert.match(ddl, /loyalty_transactions_ref_id_uniq/);
  });
});
