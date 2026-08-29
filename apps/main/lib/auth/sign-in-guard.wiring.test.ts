import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, '..', '..', 'app', '(app)', 'sign-in', '[[...sign-in]]', 'page.tsx');

/**
 * Wiring check for the signed-in guard on /sign-in.
 *
 * A signed-in visitor landing on /sign-in (bookmark, back button, stale
 * tab) must never be shown the sign-in form again — they should be sent
 * straight to their destination. This mirrors the guard already on `/`
 * (see app/page.tsx + lib/auth/safe-auth.ts).
 *
 * This is deliberately a source-wiring test, not a rendered-output test:
 * importing the page pulls in `@clerk/nextjs`, which throws without real
 * Clerk keys, and `next/navigation`'s `redirect()` only behaves correctly
 * inside a live Next request context. Asserting against the source proves
 * the guard exists and runs before the SignIn form renders, without
 * needing either. It lives under lib/ (not app/) because that is the only
 * directory `npm run test:main` actually globs — see package.json.
 */
describe('/sign-in redirects a signed-in visitor before rendering the form', () => {
  const src = readFileSync(PAGE, 'utf8');

  test('page checks safeAuth() for an existing session', () => {
    assert.match(src, /safeAuth\(\)/);
  });

  test('page calls redirect() when a userId is present', () => {
    assert.match(src, /if\s*\(\s*userId\s*\)\s*{\s*[\s\S]*?redirect\(/);
  });

  test('redirect target is computed through the open-redirect guard', () => {
    assert.match(src, /redirect\(getSafeRedirectUrl\(/);
  });

  test('the auth check happens before the <SignIn> form is returned', () => {
    // Strip comments first: the file has a code comment mentioning
    // "<SignIn />" (explaining the Clerk-unconfigured guard above it),
    // which would otherwise be matched as the render and make this
    // assertion pass regardless of where the real render is.
    const withoutComments = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const authCheckIndex = withoutComments.indexOf('await safeAuth()');
    const signInRenderIndex = withoutComments.indexOf('<SignIn');
    assert.ok(authCheckIndex !== -1, 'expected an await safeAuth() call');
    assert.ok(signInRenderIndex !== -1, 'expected the page to still render <SignIn>');
    assert.ok(
      authCheckIndex < signInRenderIndex,
      'safeAuth() must be checked before <SignIn> is rendered, or a signed-in visitor briefly sees the form',
    );
  });

  test('the Clerk-unconfigured fallback still runs first (unrelated guard, must not be removed)', () => {
    const unconfiguredCheckIndex = src.indexOf('clerkIsConfigured(process.env)');
    const authCheckIndex = src.indexOf('await safeAuth()');
    assert.ok(unconfiguredCheckIndex !== -1);
    assert.ok(unconfiguredCheckIndex < authCheckIndex);
  });
});

const SIGNUP_PAGE = join(HERE, '..', '..', 'app', '(app)', 'sign-up', '[[...sign-up]]', 'page.tsx');

/**
 * Same guard, mirrored on /sign-up — including the claim-token branch,
 * which must NOT just bounce a signed-in visitor to /dashboard (that would
 * silently drop their magic-link claim). It has to route through the same
 * GET /claim/redeem completion path a fresh signup would hit.
 */
describe('/sign-up redirects a signed-in visitor before rendering the form', () => {
  const src = readFileSync(SIGNUP_PAGE, 'utf8');
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('page checks safeAuth() for an existing session', () => {
    assert.match(src, /safeAuth\(\)/);
  });

  test('page calls redirect() when a userId is present', () => {
    assert.match(src, /if\s*\(\s*userId\s*\)\s*{\s*[\s\S]*?redirect\(/);
  });

  test('a signed-in visitor with a claim token is sent to /claim/redeem, not silently dropped', () => {
    assert.match(withoutComments, /if\s*\(\s*claim\s*\)\s*{\s*[\s\S]*?redirect\(['"]\/claim\/redeem['"]\)/);
  });

  test('storeClaimToken() runs before the /claim/redeem redirect for a signed-in claimant', () => {
    const storeIndex = withoutComments.indexOf('await storeClaimToken(claim)');
    const redeemRedirectIndex = withoutComments.indexOf("redirect('/claim/redeem')");
    assert.ok(storeIndex !== -1, 'expected storeClaimToken(claim) to be awaited');
    assert.ok(redeemRedirectIndex !== -1, "expected redirect('/claim/redeem')");
    assert.ok(storeIndex < redeemRedirectIndex);
  });

  test('a signed-in visitor with no claim token falls back to the safe redirect target', () => {
    assert.match(withoutComments, /redirect\(fallback\)/);
  });

  test('the auth check happens before the <SignUp> form is returned', () => {
    const authCheckIndex = withoutComments.indexOf('await safeAuth()');
    const signUpRenderIndex = withoutComments.indexOf('<SignUp');
    assert.ok(authCheckIndex !== -1, 'expected an await safeAuth() call');
    assert.ok(signUpRenderIndex !== -1, 'expected the page to still render <SignUp>');
    assert.ok(
      authCheckIndex < signUpRenderIndex,
      'safeAuth() must be checked before <SignUp> is rendered, or a signed-in visitor briefly sees the form',
    );
  });

  test('the Clerk-unconfigured fallback still runs first (unrelated guard, must not be removed)', () => {
    const unconfiguredCheckIndex = src.indexOf('clerkIsConfigured(process.env)');
    const authCheckIndex = src.indexOf('await safeAuth()');
    assert.ok(unconfiguredCheckIndex !== -1);
    assert.ok(unconfiguredCheckIndex < authCheckIndex);
  });
});
