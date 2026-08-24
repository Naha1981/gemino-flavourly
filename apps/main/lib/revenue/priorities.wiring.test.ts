import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');

/**
 * Gate #5 wiring tests.
 *
 * priorities.test.ts proves the analytics are right and exercises them
 * through the store boundary. It cannot prove the surfaces actually
 * *use* them: a summary route that forgot `topPriorities` in its
 * response, a brief that computed the top action and never appended it,
 * or an admin KPI that issued its own second query, would pass every
 * unit test.
 *
 * Invoking these handlers for real would need Clerk and a live Postgres
 * - `@/lib/db` throws at import time without DATABASE_URL - so, in the
 * same style as the Gate #2-#4 wiring tests, these assertions pin the
 * wiring at the source. They are mutation checks as much as wiring
 * checks: dropping the response field, the brief line, the tenant scope
 * or a scan predicate must fail a test here even if the unit suite
 * still passes.
 */

const SUMMARY_ROUTE = join(APP, 'api', 'revenue', 'summary', 'route.ts');
const BRIEF_ROUTE = join(APP, 'api', 'cron', 'daily-brief', 'route.ts');
const ADMIN_PAGE = join(APP, 'admin', 'page.tsx');
const LOGIC = join(HERE, 'priorities.ts');
const STORE = join(HERE, 'priorities-store.ts');

/** Strip comments so prose describing behaviour is not mistaken for code. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** Everything from the start of a statement to the end of the file. */
function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

/** Just the body between two markers, so assertions cannot bleed across methods. */
function section(src: string, startNeedle: string, endNeedle: string): string {
  const body = from(src, startNeedle);
  const end = body.indexOf(endNeedle);
  assert.ok(end > -1, `"${endNeedle}" not found after "${startNeedle}"`);
  return body.slice(0, end);
}

describe('seam 1: GET /api/revenue/summary returns topPriorities', () => {
  const src = code(SUMMARY_ROUTE);

  test('imports the priority analytics and its Drizzle store', () => {
    assert.match(src, /buildTenantPriorities[^}]*\}\s*from\s+'@\/lib\/revenue\/priorities'/);
    assert.match(src, /drizzlePriorityStore[^}]*\}\s*from\s+'@\/lib\/revenue\/priorities-store'/);
  });

  test('computes the priorities for the signed-in tenant, reusing the Gate #2 report', () => {
    // tenant.id is the isolation boundary; `slowDays` is the report the
    // route already fetched, so the reservation history is scanned once.
    assert.match(src, /buildTenantPriorities\(\s*drizzlePriorityStore\s*,\s*tenant\.id\s*,\s*slowDays\s*\)/);
  });

  test('puts the ranked actions in the JSON response body', () => {
    const response = from(src, 'return NextResponse.json({');
    assert.match(response, /\btopPriorities\s*,/);
  });

  test('the existing response fields are untouched by this gate', () => {
    const response = from(src, 'return NextResponse.json({');
    assert.match(response, /slowDays:\s*slowDays\.slowDays/);
    assert.match(response, /conversion_rate:\s*conversionRate/);
    assert.match(response, /range:\s*\{/);
  });
});

describe("seam 2: the morning brief appends today's top action", () => {
  const src = code(BRIEF_ROUTE);

  test('imports the analytics and the store', () => {
    assert.match(src, /buildTenantPriorities[^}]*\}\s*from\s+'@\/lib\/revenue\/priorities'/);
    assert.match(src, /drizzlePriorityStore[^}]*\}\s*from\s+'@\/lib\/revenue\/priorities-store'/);
  });

  test('computes the priorities for the tenant, from the same report the slow-day alerts use', () => {
    assert.match(src, /buildTenantPriorities\(\s*drizzlePriorityStore\s*,\s*tenant\.id\s*,\s*slowDays\s*\)/);
  });

  test("appends 'Today's top action' only when a top priority exists", () => {
    const text = from(src, 'const text = [');
    assert.match(text, /\.\.\.\(topPriority\s*\?/);
    assert.match(text, /🎯 Today's top action: \$\{topPriority\.description\}/);
  });

  test('the line still goes out through the outbox job', () => {
    assert.match(from(src, 'await db.insert(jobs)'), /payload:\s*\{[^}]*\btext\s*\}/);
  });

  test('no new cron handler was introduced', () => {
    // The brief already runs on cron-job.org; this gate only extends it.
    assert.equal(src.match(/export async function (GET|POST)\(/g)?.length, 1);
  });

  test('the tenant count with a top priority is reported by the cron', () => {
    assert.match(from(src, 'return NextResponse.json({'), /tenantsWithTopPriority:\s*prioritized/);
  });
});

describe('seam 3: the super-admin overview shows Total Priority Value from the shared fetch', () => {
  const src = code(ADMIN_PAGE);

  test('renders the KPI', () => {
    assert.match(src, /title="Total Priority Value"/);
    assert.match(src, /value=\{\`R\$\{\(totalPriorityValueCents/);
  });

  test('derives it from the same single fetch as the slow-day KPI', () => {
    // One platform-wide read, two KPIs: the priority value must consume
    // the `slowDayAggregates` the page already fetched, not run its own
    // second query over the reservation history.
    assert.equal(src.match(/fetchSlowDayAggregatesByTenant\(/g)?.length, 1);
    assert.match(src, /totalTopPriorityValueCents\(\s*slowDayAggregates\s*,/);
  });

  test('fetch failure degrades to an empty map, so the KPI renders 0', () => {
    assert.match(from(src, 'fetchSlowDayAggregatesByTenant('), /\.catch\(\(\)\s*=>\s*new Map/);
  });
});

describe('seam 4: the Drizzle store scans the right rows, scoped to the tenant', () => {
  const src = code(STORE);

  test('missed enquiries: this tenants valued missed_enquiry events in the window', () => {
    const body = section(src, 'findMissedEnquiries', 'findPendingCancellations');
    assert.match(body, /eq\(revenueEvents\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(revenueEvents\.eventType,\s*'missed_enquiry'\)/);
    assert.match(body, /gte\(revenueEvents\.estimatedValueCents,\s*1\)/);
    assert.match(body, /gte\(revenueEvents\.occurredAt,\s*start\)/);
    assert.match(body, /lte\(revenueEvents\.occurredAt,\s*end\)/);
  });

  test('cancellations: cancelled, not yet followed up, cancelled inside the window', () => {
    const body = section(src, 'findPendingCancellations', 'findPendingNoShows');
    assert.match(body, /eq\(reservations\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(reservations\.status,\s*'cancelled'\)/);
    assert.match(body, /eq\(reservations\.cancellationFollowupSent,\s*false\)/);
    assert.match(body, /gte\(reservations\.cancelledAt,\s*start\)/);
    assert.match(body, /lte\(reservations\.cancelledAt,\s*end\)/);
  });

  test('no-shows: detected, not yet followed up, detected inside the window', () => {
    const body = section(src, 'findPendingNoShows', '};');
    assert.match(body, /eq\(reservations\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(reservations\.noShowDetected,\s*true\)/);
    assert.match(body, /eq\(reservations\.noShowFollowupSent,\s*false\)/);
    assert.match(body, /gte\(reservations\.noShowDetectedAt,\s*start\)/);
    assert.match(body, /lte\(reservations\.noShowDetectedAt,\s*end\)/);
  });
});

describe('seam 5: the logic module is framework-free and clock-injected', () => {
  const src = code(LOGIC);

  test('imports no database, framework or route modules', () => {
    assert.doesNotMatch(src, /from\s+['"]@\/lib\/db['"]/);
    assert.doesNotMatch(src, /from\s+['"]next\//);
    assert.doesNotMatch(src, /from\s+['"]drizzle-orm['"]/);
  });

  test('no hidden clock: every new Date() sits behind an options.now ?? fallback', () => {
    const pattern = /new Date\(\)/g;
    let match: RegExpExecArray | null;
    let fallbacks = 0;
    while ((match = pattern.exec(src)) !== null) {
      const before = src.slice(Math.max(0, match.index - 24), match.index);
      assert.ok(before.includes('options.now ?? '), `bare new Date() near index ${match.index}`);
      fallbacks += 1;
    }
    assert.ok(fallbacks >= 3, 'expected the now fallbacks in buildPriorities, buildTenantPriorities and topPriorityValueCentsByTenant');
  });
});
