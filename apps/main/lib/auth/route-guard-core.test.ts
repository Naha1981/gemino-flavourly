import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicPath, isStaticAssetPath, clerkIsConfigured, guardRequest, normalizePath } from './route-guard-core.ts';

/**
 * RC1 — "the app does not load at all".
 *
 * Reproduced before the fix: with no publishable key present, `next start`
 * returned 500 for /, /pricing, /privacy, /terms, /sign-in, /sign-up,
 * /dashboard and /admin alike (only /manifest.json and /icon.svg survived,
 * because the matcher excluded them). Server log:
 *
 *   Error: @clerk/nextjs: Missing publishableKey.
 *     at Object.throwMissingPublishableKeyError (middleware.js:20:1613)
 *
 * These tests pin the decision logic that keeps public routes alive when
 * Clerk is misconfigured.
 */

describe('route guard — public routes survive with no Clerk config', () => {
  const PUBLIC = [
    '/',
    '/pricing',
    '/privacy',
    '/terms',
    '/sign-in',
    '/sign-up',
    '/onboarding',
    '/claim/deadbeef-token',
    '/claim/redeem',
    '/m/the-rusty-pan',
    '/geo-claim/deadbeef-token',
    '/api/loyalty/geo-claim/deadbeef-token',
  ];

  for (const path of PUBLIC) {
    test(`${path} is public`, () => {
      assert.equal(isPublicPath(path), true, `${path} must be public`);
    });

    test(`${path} passes even when Clerk is NOT configured`, () => {
      assert.deepEqual(guardRequest({ rawPath: path, clerkConfigured: false }), { action: 'pass' });
    });

    test(`${path} passes when Clerk IS configured`, () => {
      assert.deepEqual(guardRequest({ rawPath: path, clerkConfigured: true }), { action: 'pass' });
    });
  }
});

describe('route guard — static assets are never redirected', () => {
  const ASSETS = [
    '/manifest.json',
    '/icon.svg',
    '/logo.png',
    '/logo-mark.png',
    '/fonts/playfair.woff2',
    '/site.webmanifest',
    '/_next/static/chunks/main.js',
    '/robots.txt',
  ];

  for (const path of ASSETS) {
    test(`${path} is a static asset`, () => {
      assert.equal(isStaticAssetPath(path), true, `${path} must be treated as static`);
      assert.equal(isPublicPath(path), true, `${path} must be public`);
      assert.deepEqual(guardRequest({ rawPath: path, clerkConfigured: false }), { action: 'pass' });
    });
  }

  test('a route that merely CONTAINS a dot is not a static asset', () => {
    assert.equal(isStaticAssetPath('/dashboard'), false);
    assert.equal(isStaticAssetPath('/admin/prospects'), false);
  });
});

describe('route guard — protected routes stay protected', () => {
  const PROTECTED = [
    '/dashboard',
    '/dashboard/inbox',
    '/dashboard/analytics',
    '/dashboard/operations/channel-configs',
    '/admin',
    '/admin/analytics',
    '/admin/prospects',
  ];

  for (const path of PROTECTED) {
    test(`${path} is NOT public`, () => {
      assert.equal(isPublicPath(path), false, `${path} must not be public`);
    });

    test(`${path} is protected when Clerk works`, () => {
      assert.deepEqual(guardRequest({ rawPath: path, clerkConfigured: true }), { action: 'protect' });
    });

    test(`${path} redirects to /sign-in (never 500) when Clerk is broken`, () => {
      assert.deepEqual(guardRequest({ rawPath: path, clerkConfigured: false }), {
        action: 'redirect',
        to: '/sign-in',
      });
    });
  }
});

describe('route guard — /api/health is public and unauthenticated', () => {
  test('/api/health is public', () => {
    assert.equal(isPublicPath('/api/health'), true);
  });

  test('other /api routes are NOT public by default', () => {
    assert.equal(isPublicPath('/api/tenant/list'), false);
    assert.equal(isPublicPath('/api/settings'), false);
  });

  test('webhook + cron + whatsapp + migrate stay public', () => {
    assert.equal(isPublicPath('/api/webhooks/whatsapp'), true);
    assert.equal(isPublicPath('/api/cron/outbox'), true);
    assert.equal(isPublicPath('/api/whatsapp/status'), true);
    assert.equal(isPublicPath('/api/migrate'), true);
  });
});

describe('route guard — PayFast ITN webhook is public, the rest of billing is not', () => {
  // PayFast POSTs the ITN server-to-server with no Clerk session; the route
  // authenticates via the MD5 signature. If the middleware protects this
  // path, auth().protect() answers the unauthenticated POST with a 404 and
  // every payment notification is silently dropped.
  test('/api/billing/webhook is public', () => {
    assert.equal(isPublicPath('/api/billing/webhook'), true);
    assert.deepEqual(guardRequest({ rawPath: '/api/billing/webhook', clerkConfigured: true }), {
      action: 'pass',
    });
  });

  test('/api/billing/checkout and /api/billing/cancel stay protected', () => {
    assert.equal(isPublicPath('/api/billing/checkout'), false);
    assert.equal(isPublicPath('/api/billing/cancel'), false);
    assert.deepEqual(guardRequest({ rawPath: '/api/billing/checkout', clerkConfigured: true }), {
      action: 'protect',
    });
  });
});

describe('route guard — clerkIsConfigured', () => {
  test('accepts well-formed pk_test_ / pk_live_ keys', () => {
    assert.equal(clerkIsConfigured({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_ZHVtbXk' }), true);
    assert.equal(clerkIsConfigured({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_ZHVtbXk' }), true);
  });

  test('rejects unset, empty, and malformed keys', () => {
    assert.equal(clerkIsConfigured({}), false);
    assert.equal(clerkIsConfigured({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '' }), false);
    assert.equal(clerkIsConfigured({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'not-a-key' }), false);
    assert.equal(clerkIsConfigured({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'sk_test_ZHVtbXk' }), false);
  });

  test('falls back to CLERK_PUBLISHABLE_KEY', () => {
    assert.equal(clerkIsConfigured({ CLERK_PUBLISHABLE_KEY: 'pk_test_ZHVtbXk' }), true);
  });
});

describe('route guard — path normalisation', () => {
  test('query strings and hashes are ignored', () => {
    assert.equal(isPublicPath('/pricing?ref=x'), true);
    assert.equal(isPublicPath('/dashboard#top'), false);
  });

  test('trailing slashes match the same route', () => {
    assert.equal(isPublicPath('/pricing/'), true);
    assert.equal(normalizePath('/pricing/'), '/pricing');
    assert.equal(normalizePath('/'), '/');
    assert.equal(normalizePath('//dashboard//'), '/dashboard');
  });

  test('a path without a leading slash is normalised', () => {
    assert.equal(normalizePath('pricing'), '/pricing');
    assert.equal(isPublicPath('pricing'), true);
  });
});
