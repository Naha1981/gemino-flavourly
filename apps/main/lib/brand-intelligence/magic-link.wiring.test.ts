import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isPublicPath, guardRequest } from '../auth/route-guard-core.ts';

/**
 * Seam/source-contract tests for the magic-link feature (Gate 3).
 *
 * Executing the routes for real needs Postgres + Clerk, which this runner
 * doesn't have. These assertions verify the WIRING — that each security
 * boundary and flow seam is actually present and ordered correctly — mirroring
 * the repo's existing pipeline.wiring.test.ts style. Behaviour is covered by
 * the pure unit tests (scraper / seed-data / magic-link / prospects).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');

const ADMIN_PAGE = join(APP, '(app)', 'admin', 'prospects', 'page.tsx');
const PROSPECTS_API = join(APP, 'api', 'prospects', 'route.ts');
const PROSPECT_BUILD = join(APP, 'api', 'prospects', '[id]', 'build', 'route.ts');
const CLAIM_PAGE = join(APP, '(app)', 'claim', '[token]', 'page.tsx');
const CLAIM_REDEEM_ROUTE = join(APP, '(app)', 'claim', 'redeem', 'route.ts');
const CLAIM_REDEEM_API = join(APP, 'api', 'claim', 'redeem', 'route.ts');
const CRON_PROCESS = join(APP, 'api', 'cron', 'process-prospects', 'route.ts');
const MIDDLEWARE = join(APP, '..', 'middleware.ts');
const SIGNUP_PAGE = join(APP, '(app)', 'sign-up', '[[...sign-up]]', 'page.tsx');
const SIGNUP_ACTIONS = join(APP, '(app)', 'sign-up', 'actions.ts');

/** Strip comments so prose describing an old behaviour is not matched. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/{\/\*[\s\S]*?\*\/}/g, '');
}

describe('security: super admin console + APIs fail closed', () => {
  test('/admin/prospects gate uses isSuperAdmin()', () => {
    const src = code(ADMIN_PAGE);
    assert.match(src, /isSuperAdmin\(\)/);
    assert.match(src, /if \(!userId \|\| !authorized\)/);
    assert.match(src, /redirect\('\/sign-in'\)/);
  });

  test('prospects API routes are gated by isSuperAdmin()', () => {
    const src = code(PROSPECTS_API);
    assert.match(src, /isSuperAdmin\(\)/);
    assert.match(src, /status: 403/);
    const build = code(PROSPECT_BUILD);
    assert.match(build, /isSuperAdmin\(\)/);
    assert.match(build, /status: 403/);
  });

  test('magic link /claim page is PUBLIC in middleware', () => {
    // The public-route list moved out of middleware.ts into the pure guard
    // (lib/auth/route-guard-core.ts) when the middleware was rewritten to
    // decide "public?" before touching Clerk. Assert the behaviour directly
    // against that guard rather than a regex over middleware source, which
    // is a stronger check of the same intent.
    assert.ok(isPublicPath('/claim/deadbeef-token'), '/claim/<token> must be public');
    assert.ok(isPublicPath('/claim/redeem'), '/claim/redeem must be public');
    assert.deepEqual(guardRequest({ rawPath: '/claim/deadbeef-token', clerkConfigured: false }), {
      action: 'pass',
    });

    // And the middleware must actually consult that guard.
    const src = code(MIDDLEWARE);
    assert.match(src, /from '@\/lib\/auth\/route-guard-core'/);
    assert.match(src, /guardRequest\(/);
  });

  test('the claim redeem route enforces auth itself and clears the cookie', () => {
    const src = code(CLAIM_REDEEM_ROUTE);
    assert.match(src, /if \(!userId\)/);
    assert.match(src, /NextResponse\.redirect\(new URL\('\/sign-in'/);
    assert.match(src, /redeemClaimToken\(token, userId\)/);
    assert.match(src, /cookies\(\)\.set\(CLAIM_COOKIE, ''/);
  });
});

describe('claim flow seams', () => {
  test('sign-up points post-signup redirection at the redeem page when claiming', () => {
    const src = code(SIGNUP_PAGE);
    assert.match(src, /afterSignUpUrl=\{claim \? '\/claim\/redeem' : fallback\}/);
    assert.match(src, /getSafeRedirectUrl\(/);
  });

  test('sign-up stashes the claim token in a SameSite cookie via a server action', () => {
    const src = code(SIGNUP_ACTIONS);
    assert.match(src, /cookies\(\)\.set\(CLAIM_COOKIE/);
    assert.match(src, /sameSite: 'lax'/);
    assert.match(src, /httpOnly: true/);
  });

  test('/api/claim/redeem reads the cookie and is idempotent via redeemClaimToken', () => {
    const api = code(CLAIM_REDEEM_API);
    assert.match(api, /cookies\(\)\.get\(CLAIM_COOKIE\)/);
    assert.match(api, /redeemClaimToken\(token, userId\)/);
    assert.match(api, /status: 401/);
  });

  test('the cron processor is guarded by assertCronAuthorized', () => {
    const src = code(CRON_PROCESS);
    assert.match(src, /assertCronAuthorized\(req\)/);
    assert.match(src, /findBuildableProspects\(/);
    assert.match(src, /createDemoTenant\(/);
  });
});

describe('demo tenant builder seams', () => {
  test('build route runs the engine and stores the claim token on success', () => {
    const src = code(PROSPECT_BUILD);
    assert.match(src, /createDemoTenant\(/);
    // The engine returns the claim token; the route stores it on the prospect
    // rather than minting a second token.
    assert.match(src, /claimToken: result\.claimToken/);
    assert.match(src, /status: 'ready'/);
    assert.match(src, /status: 'failed'/);
  });

  test('claim page renders the gold claim button and never re-claims', () => {
    const src = code(CLAIM_PAGE);
    assert.match(src, /assessClaimToken\(/);
    assert.match(src, /ClaimButton/);
    assert.match(src, /ClaimAlreadyClaimed/);
    assert.match(src, /ThemeProvider/);
  });

  test('claim page scopes every sample-data query to the token tenant (isolation)', () => {
    const src = code(CLAIM_PAGE);
    // Each set of demo data must be filtered to the tenant resolved from the
    // token — never a global read that could leak another tenant's rows.
    assert.match(src, /eq\(googleReviews\.tenantId, tenant\.id\)/);
    assert.match(src, /eq\(reservations\.tenantId, tenant\.id\)/);
    assert.match(src, /eq\(marketingCampaigns\.tenantId, tenant\.id\)/);
  });
});
