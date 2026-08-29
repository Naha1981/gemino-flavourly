import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');

/**
 * Gate #2 wiring tests.
 *
 * slow-days.test.ts proves the analytics are right and exercises them
 * through the store boundary against 90 days of seeded reservations. It
 * cannot prove the three surfaces actually *use* them: a route that forgot
 * to put `slowDays` in its response, or a brief that computed the alerts
 * and never appended them, would pass every unit test.
 *
 * Invoking these handlers for real would need Clerk and a live Postgres —
 * `@/lib/db` throws at import time without DATABASE_URL — and mocking that
 * whole stack would mostly test the mocks (the same trade-off
 * lib/cron/routes.wiring.test.ts and lib/messaging/pipeline.wiring.test.ts
 * already make). So these assertions pin the wiring at the source: each
 * surface must call the shared analytics and feed the result into the thing
 * the user actually sees.
 */

const SUMMARY_ROUTE = join(APP, 'api', 'revenue', 'summary', 'route.ts');
const BRIEF_ROUTE = join(APP, 'api', 'cron', 'daily-brief', 'route.ts');
const ADMIN_PAGE = join(APP, '(app)', 'admin', 'page.tsx');
const STORE = join(HERE, 'slow-days-store.ts');

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

describe('seam 1: GET /api/revenue/summary returns slowDays', () => {
  const src = code(SUMMARY_ROUTE);

  test('imports the shared analytics and the Drizzle store', () => {
    assert.match(src, /detectSlowDaysForTenant[^}]*\}\s*from\s+'@\/lib\/revenue\/slow-days'/);
    assert.match(src, /drizzleSlowDayStore[^}]*\}\s*from\s+'@\/lib\/revenue\/slow-days-store'/);
  });

  test('runs detection for the signed-in tenant', () => {
    assert.match(src, /detectSlowDaysForTenant\(\s*drizzleSlowDayStore\s*,\s*tenant\.id\s*\)/);
  });

  test('puts the flagged days in the JSON response body', () => {
    const response = from(src, 'return NextResponse.json({');
    assert.match(response, /slowDays:\s*slowDays\.slowDays/);
  });

  test('the Gate #1 missed-enquiry fields are still returned', () => {
    const response = from(src, 'return NextResponse.json({');
    assert.match(response, /\.\.\.summary/);
    assert.match(src, /missed_count/);
    assert.match(src, /missed_revenue_cents/);
    assert.match(response, /conversion_rate:\s*conversionRate/);
    assert.match(response, /range:\s*\{/);
  });

  test('the Gate #1 enquiry query is untouched by this gate', () => {
    assert.match(src, /from\(conversations\)/);
    assert.match(src, /gte\(conversations\.createdAt,\s*range\.start\)/);
  });
});

describe('seam 2: the morning brief appends the slow-day alert', () => {
  const src = code(BRIEF_ROUTE);

  test('imports the analytics and the alert formatter', () => {
    assert.match(src, /detectSlowDaysForTenant,\s*slowDayAlertLines[^}]*\}\s*from\s+'@\/lib\/revenue\/slow-days'/);
    assert.match(src, /drizzleSlowDayStore[^}]*\}\s*from\s+'@\/lib\/revenue\/slow-days-store'/);
  });

  test('escalates only the critical (<50%) tier', () => {
    assert.match(src, /slowDayAlertLines\(\s*slowDays\.criticalSlowDays\s*\)/);
  });

  test('the alerts are appended to the message the owner receives', () => {
    const text = from(src, 'const text = [');
    assert.match(text, /\.\.\.slowDayAlerts/);
    // The same `text` still goes out through the outbox job.
    assert.match(from(src, 'await db.insert(jobs)'), /payload:\s*\{[^}]*\btext\s*\}/);
  });

  test('the count of alerted tenants is reported by the cron', () => {
    assert.match(from(src, 'return NextResponse.json({'), /tenantsWithSlowDayAlert:\s*alerted/);
  });

  test('no new cron job was introduced for this', () => {
    // The brief already runs on cron-job.org; this gate only extends it.
    assert.equal(src.match(/export async function (GET|POST)\(/g)?.length, 1);
  });
});

describe('seam 3: the super-admin overview counts slow days platform-wide', () => {
  const src = code(ADMIN_PAGE);

  test('renders the metric', () => {
    assert.match(src, /title="Slow Days Detected"/);
    assert.match(src, /value=\{slowDaysDetected\.toString\(\)\}/);
  });

  test('derives it from the shared analytics over every tenant', () => {
    assert.match(src, /fetchSlowDayAggregatesByTenant\(\s*slowDayWindow\.historyStart\s*,\s*slowDayWindow\.weekEnd\s*\)/);
    assert.match(src, /analyzeDayAggregates\(/);
    assert.match(src, /totalSlowDays\(/);
  });

  test('fetch failure degrades to an empty map, so the metric renders 0', () => {
    // Gate #5 restructured this seam: instead of `.catch(() => 0)` on an
    // already-derived count, the fetch itself now fails over to an empty
    // map, and every KPI derived from it — totalSlowDays included —
    // computes 0 over an empty map. Same invariant, new mechanism.
    const fetchCall = from(src, 'fetchSlowDayAggregatesByTenant(');
    assert.match(fetchCall, /\.catch\(\(\)\s*=>\s*new Map/);
    assert.ok(
      fetchCall.indexOf('totalSlowDays(') > fetchCall.indexOf('.catch('),
      'totalSlowDays must be derived from the caught value, not a separate fetch'
    );
  });

  test('the single shared fetch also feeds the Gate #5 priority KPI', () => {
    // One query, two KPIs: the "Total Priority Value" must reuse the same
    // per-tenant aggregate the slow-day count uses, not issue a second
    // platform-wide read of the reservation history.
    assert.equal(src.match(/fetchSlowDayAggregatesByTenant\(/g)?.length, 1);
    assert.match(src, /totalTopPriorityValueCents\(\s*slowDayAggregates\s*,/);
  });
});

describe('seam 4: the Drizzle store reads the window the analytics expect', () => {
  const src = code(STORE);

  test('the window end is exclusive, so the day in progress is never read', () => {
    assert.match(src, /lt\(reservations\.date,\s*end\)/);
    assert.match(src, /gte\(reservations\.date,\s*start\)/);
  });

  test('cancelled reservations are excluded', () => {
    assert.match(src, /ne\(reservations\.status,\s*'cancelled'\)/);
  });

  test('the platform-wide query is scoped per tenant and per calendar day', () => {
    assert.match(src, /\.groupBy\(\s*reservations\.tenantId\s*,\s*dayExpression\s*\)/);
    assert.match(src, /to_char\(\$\{reservations\.date\},\s*'YYYY-MM-DD'\)/);
    assert.match(src, /count\(\*\)::int/);
  });
});
