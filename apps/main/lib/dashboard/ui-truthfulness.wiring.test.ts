import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * GATE UI-3R — wiring tests: the pages themselves must carry the fixes.
 *
 * Written BEFORE the fixes are applied (failing-first). Each assertion pins
 * one owner-verified symptom (S1–S26) to the source file that must change.
 * These run against the raw page source, so they fail loudly the moment a
 * regression reintroduces a symptom.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, '..', '..');

function src(rel: string): string {
  const p = join(MAIN, rel);
  assert.ok(existsSync(p), `missing file: ${rel}`);
  return readFileSync(p, 'utf8');
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ---------------------------------------------------------------------------
// OVERVIEW (S1–S5)
// ---------------------------------------------------------------------------

describe('UI-3R — Overview page wiring', () => {
  const OVERVIEW = 'app/(app)/dashboard/page.tsx';

  test('S1/F1: AI Bookings number and subtext derive from ONE query (aiBookingsCard helper)', () => {
    const code = stripComments(src(OVERVIEW));
    assert.match(code, /aiBookingsCard/, 'must use the single-source KPI helper');
    assert.ok(!/tables booked today'\}/.test(code.replace(/aiBookingsCard[\s\S]*?\)/g, '')), 'no ad-hoc subtext string next to a separate count');
  });

  test('S2/F2: live queries exclude deadbeef demo rows (query-scope guard)', () => {
    const code = stripComments(src(OVERVIEW));
    assert.match(code, /liveRowsOnly|isDemoTenantId|query-scope/, 'must apply the live/demo guard');
  });

  test('S2/F2: SAMPLE chip renders on KPIs while demo mode is on', () => {
    const code = stripComments(src(OVERVIEW));
    assert.match(code, /sampleChipLabel|SAMPLE/, 'KPI cards must be able to render a SAMPLE chip');
  });

  test('S5/F1: week-on-week badge renders a real percentage or nothing (no bare arrow)', () => {
    const code = stripComments(src(OVERVIEW));
    assert.match(code, /revenueWowBadge/, 'must use the honest trend badge helper');
  });

  test('S3/F3: the 7-day chart has an explicit empty state', () => {
    const code = stripComments(src(OVERVIEW));
    assert.match(code, /revenueChartHasData|EMPTY_REVENUE_CHART_MESSAGE/, 'chart must render an honest empty state');
  });

  test('S4/F7: reputation badge says "unanswered"', () => {
    const code = stripComments(src(OVERVIEW));
    assert.match(code, /unansweredBadge/, 'must use the unanswered wording helper');
  });
});

// ---------------------------------------------------------------------------
// INBOX (S6)
// ---------------------------------------------------------------------------

describe('UI-3R — Inbox page wiring', () => {
  const INBOX = 'app/(app)/dashboard/inbox/page.tsx';

  test('S6/F4: badge state is derived from the live WhatsApp account, not hardcoded', () => {
    const code = stripComments(src(INBOX));
    assert.match(code, /waAccounts/, 'must read the live wa_accounts status');
  });

  test('S6/F4: disconnected state shows "Idle — connect WhatsApp to start" in amber', () => {
    const code = stripComments(src(INBOX));
    assert.match(code, /Idle — connect WhatsApp to start/, 'must carry the idle copy');
  });

  test('S6/F4: right pane no longer claims active monitoring while disconnected', () => {
    const code = stripComments(src(INBOX));
    assert.ok(!/actively monitoring your connected channels/.test(code), 'false-alive copy must be gone');
    assert.match(code, /No connected channels yet/, 'honest right-pane copy required');
  });
});

// ---------------------------------------------------------------------------
// CUSTOMERS (S7, S8) + VIP TODAY (S10)
// ---------------------------------------------------------------------------

describe('UI-3R — Customers & VIP Today wiring', () => {
  const CUSTOMERS = 'app/(app)/dashboard/customers/page.tsx';
  const VIP = 'app/(app)/dashboard/customers/vip-today/page.tsx';

  test('S7/F5: zero-profile empty state is honest (no "Great retention!" on an empty room)', () => {
    const code = stripComments(src(CUSTOMERS));
    assert.match(code, /customersAtRiskEmptyState|No guests yet — they appear after their first booking/, 'must use the honest zero-state');
    assert.ok(!/Great retention!'\}/.test(code), 'unconditional retention celebration must be gone');
  });

  test('S8/F5: 0% segment share renders "—", and zero-count bars are hidden', () => {
    const code = stripComments(src(CUSTOMERS));
    assert.match(code, /segmentShare/, 'must use the share helper that renders null at zero');
  });

  test('S10/F8: VIP Today has exactly ONE back affordance', () => {
    const code = stripComments(src(VIP));
    const backLinks = code.match(/← All customers|Back to inbox|ArrowLeft/g) ?? [];
    assert.equal(backLinks.length, 1, `expected exactly one back affordance, found ${backLinks.length}`);
  });
});

// ---------------------------------------------------------------------------
// REPUTATION (S11, S12)
// ---------------------------------------------------------------------------

describe('UI-3R — Reputation wiring', () => {
  const REPUTATION = 'app/(app)/dashboard/reputation/page.tsx';

  test('S11/F6: drafts are ensured on page load (ensureReviewDrafts)', () => {
    const code = stripComments(src(REPUTATION));
    assert.match(code, /ensureReviewDrafts/, 'must pre-generate drafts for draft-less reviews on load');
  });
});

describe('UI-3R — seed review variety (S12)', () => {
  const GEN = 'lib/demo/seed-generators.ts';
  const DATA = 'lib/demo/seed-data.ts';

  test('F7: generator produces at least 20 distinct review texts across 40 reviews', async () => {
    const { generateReviews } = await import('../demo/seed-generators.ts');
    const rows = generateReviews('t', new Date('2026-08-31T12:00:00Z'));
    const distinct = new Set(rows.map((r) => r.text));
    assert.ok(distinct.size >= 20, `expected >= 20 distinct texts, got ${distinct.size}`);
  });

  test('F7: the view-time DEMO_REVIEWS dataset has no identical sentences under different names', () => {
    const code = stripComments(src(DATA));
    const matches = Array.from(code.matchAll(/text:\s*'([^']+)'/g)).map((m) => m[1]);
    const distinct = new Set(matches);
    assert.equal(matches.length, distinct.size, `DEMO_REVIEWS texts must all be distinct (${distinct.size}/${matches.length})`);
  });
});

// ---------------------------------------------------------------------------
// ANALYTICS (S13–S16)
// ---------------------------------------------------------------------------

describe('UI-3R — Analytics wiring', () => {
  const PAGE = 'app/(app)/dashboard/analytics/page.tsx';
  const TABS = 'app/(app)/dashboard/analytics/analytics-tabs.tsx';
  const STORE = 'lib/analytics/store.ts';

  test('S13/F2: analytics store supports excluding demo rows from live views', () => {
    const code = stripComments(src(STORE));
    assert.match(code, /includeDemoRows|liveRowsOnly|query-scope/, 'store must be able to exclude deadbeef rows');
  });

  test('S14/F7: no DollarSign icon anywhere on the Analytics cards', () => {
    const code = stripComments(src(TABS));
    assert.ok(!/DollarSign/.test(code), 'the "$" icon must be gone from this Rand product');
  });

  test('S14/F7: values render through Rand/count formatters (no raw toLocaleString)', () => {
    const code = stripComments(src(TABS));
    assert.match(code, /formatEngineTotal|formatRand/, 'engine-aware formatting required');
    assert.ok(!/summary\.total30\.toLocaleString\(\)/.test(code), 'raw number rendering must be gone');
    assert.ok(!/ma7\?\.toFixed\(1\)/.test(code), 'raw decimal moving averages must be gone');
  });

  test('S15/F7: trend badge renders nothing when the percentage is null', () => {
    const code = stripComments(src(TABS));
    assert.match(code, /trendBadgeLabel/, 'must use the badge that disappears on null');
  });

  test('S16/F7: "Operations" is labelled in owner language ("Conversations")', () => {
    const code = stripComments(src(TABS));
    assert.match(code, /Conversations/, 'owner-language label required');
  });

  test('S16/F3: analytics tabs render honest empty states, not bare numbers', () => {
    const code = stripComments(src(TABS));
    assert.match(code, /No verified revenue yet|emptyState|EMPTY/, 'tabs need honest empty states');
  });

  test('F2: the analytics page threads demo mode into the query scope', () => {
    const code = stripComments(src(PAGE));
    assert.match(code, /isDemoModeActive|demoMode/, 'page must know live vs demo');
  });
});

// ---------------------------------------------------------------------------
// APPROVALS (S17)
// ---------------------------------------------------------------------------

describe('UI-3R — Approvals wiring', () => {
  const APPROVALS = 'app/(app)/dashboard/operations/approval-requests/page.tsx';

  test('S17/F5: empty state teaches what gets flagged (discounts, dietary/medical claims, complaints)', () => {
    const code = stripComments(src(APPROVALS));
    assert.match(code, /discount/i, 'must mention discounts');
    assert.match(code, /complaint/i, 'must mention complaints');
  });

  test('S17/F5: resolved history is visible even when empty (a note, not silence)', () => {
    const code = stripComments(src(APPROVALS));
    assert.match(code, /resolved/i, 'resolved state must be addressed');
  });
});

// ---------------------------------------------------------------------------
// MARKET INTELLIGENCE (S18, S19)
// ---------------------------------------------------------------------------

describe('UI-3R — Market Intelligence wiring', () => {
  const MARKET = 'app/(app)/dashboard/market/competitors/page.tsx';
  const OPPS = 'app/(app)/dashboard/market/opportunities/page.tsx';

  test('S18/F9: sweep copy no longer promises "Daily 8am sweep" unconditionally', () => {
    const code = stripComments(src(MARKET));
    assert.ok(!/Daily 8am sweep/.test(code), 'the 8am promise must be gone');
    assert.match(code, /once competitors are added/, 'copy must state the actual precondition');
  });

  test('S19/F9: Opportunities/Positioning links are hidden until data exists', () => {
    const code = stripComments(src(MARKET));
    assert.match(code, /rows\.length > 0 &&/, 'links must be gated on tracked competitors');
  });
});

// ---------------------------------------------------------------------------
// CALENDAR (S20–S23)
// ---------------------------------------------------------------------------

describe('UI-3R — Marketing Calendar wiring', () => {
  const CALENDAR = 'app/(app)/dashboard/marketing/calendar/page.tsx';

  test('S20/F4: scheduled items show a blocked chip while WhatsApp is disconnected', () => {
    const code = stripComments(src(CALENDAR));
    assert.match(code, /waAccounts/, 'must read the live WhatsApp connection');
    assert.match(code, /blocked until WhatsApp connected/, 'blocked-state chip required');
  });

  test('S21/F10: margin-affecting offers carry an approval affordance', () => {
    const code = stripComments(src(CALENDAR));
    assert.match(code, /approval-requests|offer needs approval/, 'offers must route to or show approval state');
  });

  test('S23/F10: "To: —" never renders — the segment hides when there is no end date', () => {
    const code = stripComments(src(CALENDAR));
    assert.match(code, /item\.endsAt &&/, 'the To segment must be conditional');
  });
});

// ---------------------------------------------------------------------------
// CHANNELS (S25, S26)
// ---------------------------------------------------------------------------

describe('UI-3R — Channels wiring', () => {
  const CHANNELS = 'app/(app)/dashboard/operations/channel-configs/page.tsx';

  test('S25/F4: the WhatsApp card reads the live wa_accounts status', () => {
    const code = stripComments(src(CHANNELS));
    assert.match(code, /waAccounts/, 'must read wa_accounts, not just the channel-config table');
  });

  test('S26/F11: no API-endpoint developer talk on the owner dashboard', () => {
    const code = stripComments(src(CHANNELS));
    assert.ok(!/\/api\/operations\/channel-configs/.test(code), 'endpoint copy must be gone');
  });

  test('S26/F11: disabled channels get honest owner-language ("coming soon")', () => {
    const code = stripComments(src(CHANNELS));
    assert.match(code, /coming soon|Coming soon/, 'honest coming-soon copy required');
  });
});

// ---------------------------------------------------------------------------
// NAV (S9, S24) + LAYOUT
// ---------------------------------------------------------------------------

describe('UI-3R — nav & chrome wiring', () => {
  const CHROME = 'app/(app)/dashboard/dashboard-chrome.tsx';
  const LAYOUT = 'app/(app)/dashboard/layout.tsx';

  test('S9/F8: the sidebar resolves a single active item via resolveActiveNavHref', () => {
    const code = stripComments(src(CHROME));
    assert.match(code, /resolveActiveNavHref/, 'must use the single-active resolver');
  });

  test('F2: the chrome demo chip reflects view-time demo mode (not just seed presence)', () => {
    const code = stripComments(src(LAYOUT));
    assert.match(code, /isDemoModeActive/, 'layout must use the view-time demo gate');
  });

  test('F2: the amber demo banner renders inside the dashboard layout for every page', () => {
    const code = stripComments(src(LAYOUT));
    assert.match(code, /DemoModeBar/, 'the amber banner must wrap all dashboard pages');
  });
});

// ---------------------------------------------------------------------------
// MARKETING PAGE (audit: fabricated minimums)
// ---------------------------------------------------------------------------

describe('UI-3R — Marketing page audit wiring (F12)', () => {
  const MARKETING = 'app/(app)/dashboard/marketing/page.tsx';

  test('no Math.max(2, …) fabricated minimum on "est. tables" reach math', () => {
    const code = stripComments(src(MARKETING));
    assert.ok(!/Math\.max\(2,/.test(code), 'fabricated minimum of 2 tables must be gone');
  });
});
