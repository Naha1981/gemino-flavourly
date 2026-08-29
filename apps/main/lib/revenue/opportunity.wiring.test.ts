import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');

/**
 * Gate #6 wiring tests.
 *
 * opportunity.test.ts proves the analytics are right and exercises them
 * through the store boundary. It cannot prove the surfaces actually
 * *use* them: a summary route that forgot `opportunity` in its response,
 * a brief that computed the summary and never appended it, or an admin
 * KPI that issued its own second query, would pass every unit test.
 *
 * Invoking these handlers for real would need Clerk and a live Postgres
 * - `@/lib/db` throws at import time without DATABASE_URL - so, in the
 * same style as the Gate #2-#5 wiring tests, these assertions pin the
 * wiring at the source. They are mutation checks as much as wiring
 * checks: dropping the response field, the brief line, the tenant scope
 * or a scan predicate must fail a test here even if the unit suite
 * still passes.
 */

const SUMMARY_ROUTE = join(APP, 'api', 'revenue', 'summary', 'route.ts');
const BRIEF_ROUTE = join(APP, 'api', 'cron', 'daily-brief', 'route.ts');
const ADMIN_PAGE = join(APP, '(app)', 'admin', 'page.tsx');
const LOGIC = join(HERE, 'opportunity.ts');
const STORE = join(HERE, 'opportunity-store.ts');

/** Strip comments so prose describing behaviour is not mistaken for code. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/{\/\*[\s\S]*?\*\/}/g, '');
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

describe('integration: GET /api/revenue/summary returns the opportunity summary', () => {
  const src = code(SUMMARY_ROUTE);

  test('imports the opportunity analytics and its Drizzle store', () => {
    assert.match(src, /buildTenantOpportunity[^}]*}\s*from\s+'@\/lib\/revenue\/opportunity'/);
    assert.match(src, /drizzleOpportunityStore[^}]*}\s*from\s+'@\/lib\/revenue\/opportunity-store'/);
  });

  test('computes the summary for the signed-in tenant, reusing the Gate #2 report', () => {
    // tenant.id is the isolation boundary; `slowDays` is the report the
    // route already fetched, so the reservation history is scanned once.
    assert.match(src, /buildTenantOpportunity\(\s*drizzleOpportunityStore\s*,\s*tenant\.id\s*,\s*slowDays\s*\)/);
  });

  test('puts the opportunity summary in the JSON response body', () => {
    const response = from(src, 'return NextResponse.json({');
    assert.match(response, /\bopportunity\s*,/);
  });

  test('the existing response fields are untouched by this gate', () => {
    const response = from(src, 'return NextResponse.json({');
    assert.match(response, /slowDays:\s*slowDays\.slowDays/);
    assert.match(response, /conversion_rate:\s*conversionRate/);
    assert.match(response, /topPriorities\s*,/);
    assert.match(response, /range:\s*\{/);
  });
});

describe("integration: the morning brief appends the month's potential revenue", () => {
  const src = code(BRIEF_ROUTE);

  test('imports the analytics and the store', () => {
    assert.match(src, /buildTenantOpportunity[^}]*}\s*from\s+'@\/lib\/revenue\/opportunity'/);
    assert.match(src, /drizzleOpportunityStore[^}]*}\s*from\s+'@\/lib\/revenue\/opportunity-store'/);
  });

  test('computes the summary for the tenant, from the same report the slow-day alerts use', () => {
    assert.match(src, /buildTenantOpportunity\(\s*drizzleOpportunityStore\s*,\s*tenant\.id\s*,\s*slowDays\s*\)/);
  });

  test("appends 'potential revenue on the table this month'", () => {
    const text = from(src, 'const text = [');
    assert.match(text, /💰 You have R\$\{Math\.round\(opportunity\.total_opportunity_cents \/ 100\)\} in potential revenue on the table this month\./);
    assert.match(text, /Expected recovery: R\$\{Math\.round\(opportunity\.expected_recovery_cents \/ 100\)\}\./);
  });

  test('the line still goes out through the outbox job', () => {
    assert.match(from(src, 'await db.insert(jobs)'), /payload:\s*\{[^}]*\btext\s*\}/);
  });

  test('no new cron handler was introduced', () => {
    // The brief already runs on cron-job.org; this gate only extends it.
    assert.equal(src.match(/export async function (GET|POST)\(/g)?.length, 1);
  });
});

describe('integration: the super-admin overview shows Platform Total Opportunity from the shared fetch', () => {
  const src = code(ADMIN_PAGE);

  test('renders the KPI', () => {
    assert.match(src, /title="Platform Total Opportunity"/);
    assert.match(src, /value=\{\`R\$\{\(platformOpportunity\.total_opportunity_cents/);
  });

  test('derives it from the shared per-tenant inputs and the Gate #2 aggregates', () => {
    // The platform-wide opportunity inputs are fetched once (three bounded
    // queries for the new scans); the slow-day component reuses the same
    // `slowDayAggregates` the slow-day/priority KPIs already fetched.
    assert.match(src, /fetchCrossTenantOpportunityInputs\(/);
    assert.match(src, /calculatePlatformOpportunity\(\s*opportunityInputsByTenant\s*,/);
    assert.match(src, /slowDayAggregatesByTenant:\s*slowDayAggregates/);
    assert.equal(src.match(/fetchSlowDayAggregatesByTenant\(/g)?.length, 1);
  });

  test('fetch failure degrades to an empty map, so the KPI renders 0', () => {
    assert.match(from(src, 'fetchCrossTenantOpportunityInputs('), /\.catch\(\s*\(\)\s*=>\s*new Map/);
  });
});

describe('seam: the Drizzle store scans the right rows, scoped to the tenant', () => {
  const src = code(STORE);

  test('missed enquiries: this tenants valued missed_enquiry events in the window', () => {
    const body = section(src, 'findMissedEnquiries', 'findCancellations');
    assert.match(body, /eq\(revenueEvents\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(revenueEvents\.eventType,\s*'missed_enquiry'\)/);
    assert.match(body, /gte\(revenueEvents\.estimatedValueCents,\s*1\)/);
    assert.match(body, /gte\(revenueEvents\.occurredAt,\s*start\)/);
    assert.match(body, /lte\(revenueEvents\.occurredAt,\s*end\)/);
  });

  test('cancellations: cancelled inside the window, counted even after follow-up', () => {
    const body = section(src, 'findCancellations', 'findNoShows');
    assert.match(body, /eq\(reservations\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(reservations\.status,\s*'cancelled'\)/);
    assert.match(body, /isNotNull\(reservations\.cancelledAt\)/);
    assert.match(body, /gte\(reservations\.cancelledAt,\s*start\)/);
    assert.match(body, /lte\(reservations\.cancelledAt,\s*end\)/);
    // Mutation check: this gate counts every lost table, so it must NOT
    // require follow-up still pending (that is Gate #5's narrower view).
    assert.doesNotMatch(body, /cancellationFollowupSent/);
  });

  test('no-shows: detected inside the window, measured from no_show_detected_at', () => {
    const body = section(src, 'findNoShows', '};');
    assert.match(body, /eq\(reservations\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(reservations\.noShowDetected,\s*true\)/);
    assert.match(body, /isNotNull\(reservations\.noShowDetectedAt\)/);
    assert.match(body, /gte\(reservations\.noShowDetectedAt,\s*start\)/);
    assert.match(body, /lte\(reservations\.noShowDetectedAt,\s*end\)/);
    // Mutation check: same as cancellations — all no-shows, followed up or not.
    assert.doesNotMatch(body, /noShowFollowupSent/);
  });

  test('the platform-wide fetch groups the same rows per tenant', () => {
    const cross = from(src, 'export async function fetchCrossTenantOpportunityInputs');
    assert.match(cross, /eq\(revenueEvents\.eventType,\s*'missed_enquiry'\)/);
    assert.match(cross, /eq\(reservations\.status,\s*'cancelled'\)/);
    assert.match(cross, /eq\(reservations\.noShowDetected,\s*true\)/);
    assert.match(cross, /byTenant\.set\(row\.tenantId,\s*inputs\)/);
    assert.match(cross, /new Map<string,\s*OpportunityInputs>/);
  });
});

describe('seam: the logic module is framework-free and clock-injected', () => {
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
    assert.ok(
      fallbacks >= 3,
      'expected the now fallbacks in summarizeOpportunity, buildTenantOpportunity and calculatePlatformOpportunity'
    );
  });
});
