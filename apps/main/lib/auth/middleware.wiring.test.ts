import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * RC1 wiring: the middleware must decide "public?" BEFORE it touches Clerk,
 * because `auth()` throws when the publishable key is missing/invalid and
 * that throw used to 500 every route in the app.
 *
 * Before the fix, middleware.ts read:
 *
 *   export default clerkMiddleware((auth, request) => {
 *     if (!isPublicRoute(request)) {
 *       auth().protect();
 *     }
 *     ...
 *
 * which calls auth().protect() unconditionally for anything unmatched, with
 * no clerkIsConfigured() check and no error boundary.
 */
describe('RC1 — middleware never lets a Clerk misconfiguration 500 public routes', () => {
  const middleware = src('middleware.ts');
  const code = stripComments(middleware);

  test('imports the pure route guard', () => {
    assert.match(code, /from\s+'@\/lib\/auth\/route-guard-core'/);
    assert.match(code, /guardRequest/);
    assert.match(code, /clerkIsConfigured/);
  });

  test('uses guardRequest to make the decision', () => {
    assert.match(code, /guardRequest\(\s*\{/);
  });

  test('returns early (passes through) for public routes and static assets', () => {
    assert.match(code, /action === 'pass'/);
    assert.ok(/return\s*(NextResponse\.next\(\))?;?/.test(code), 'must be able to pass through');
  });

  test('redirects protected routes to /sign-in when Clerk is unusable', () => {
    assert.match(code, /action === 'redirect'/);
    assert.match(code, /redirect/);
  });

  test('the Clerk middleware invocation is awaited inside try/catch', () => {
    assert.match(code, /auth\(\)\.protect\(\)/);
    // clerkMiddleware's key assertions run in an async function, so they
    // REJECT. Without `await`, a try/catch cannot catch them and Next still
    // answers 500 — which is exactly the bug this fix must not reintroduce.
    assert.match(code, /try\s*\{[\s\S]*?await clerkProtectedMiddleware\(request, event\)[\s\S]*?\}\s*catch/);
  });

  test('the middleware handler is async (so the await above is real)', () => {
    assert.match(code, /export default async function middleware\(/);
  });

  test('clerkMiddleware is only ENTERED for protected routes', () => {
    // Entering clerkMiddleware at all is what triggers the key assertions,
    // so the guard decision must precede it in source order too.
    const decisionAt = code.indexOf('guardRequest({');
    const clerkCallAt = code.indexOf('await clerkProtectedMiddleware(request, event)');
    assert.ok(decisionAt > -1, 'guardRequest call not found');
    assert.ok(clerkCallAt > -1, 'clerk invocation not found');
    assert.ok(decisionAt < clerkCallAt, 'guard decision must run before Clerk is invoked');
  });

  test('the catch falls back to a redirect, not a rethrow', () => {
    const catchBlock = code.slice(code.indexOf('catch'));
    assert.ok(catchBlock.length > 0, 'expected a catch block');
    assert.ok(!/catch[^}]*\bthrow\b/.test(catchBlock.slice(0, 400)), 'catch must not rethrow');
  });

  test('no unconditional auth().protect() outside a guard', () => {
    // Every call to protect() must be preceded by a clerkConfigured check.
    assert.match(code, /clerkIsConfigured\(process\.env\)|clerkIsConfigured\(\{/);
  });
});

describe('RC1 layer 2 — root layout skips ClerkProvider when unconfigured', () => {
  const layout = stripComments(src('app/layout.tsx'));

  test('layout gates ClerkProvider behind clerkIsConfigured', () => {
    assert.match(layout, /clerkIsConfigured\(process\.env\)/);
    // ClerkProvider must only be rendered in the ready branch.
    assert.match(layout, /clerkReady\s*\?\s*<ClerkProvider>/);
  });

  test('layout logs a diagnosable error instead of throwing', () => {
    assert.match(layout, /console\.error\(/);
    assert.match(layout, /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  });

  test('the html/body shell renders on BOTH branches', () => {
    // `shell` is built once and reused, so the degraded branch still emits
    // <html>/<body> — Next requires them and a missing one is a hard error.
    assert.match(layout, /const shell = \(/);
    assert.match(layout, /return clerkReady \? <ClerkProvider>\{shell\}<\/ClerkProvider> : shell;/);
  });
});

describe('RC1 layer 3 — Clerk components have degraded stand-ins', () => {
  const shell = stripComments(src('components/clerk-shell.tsx'));

  test('clerk-shell derives readiness from a NEXT_PUBLIC_ var', () => {
    assert.match(shell, /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
    assert.match(shell, /clerkIsConfigured/);
  });

  test('every exported Clerk wrapper short-circuits when not ready', () => {
    for (const name of ['SignedIn', 'SignedOut', 'SignInButton', 'SignUpButton', 'UserButton']) {
      assert.ok(shell.includes(`export function ${name}`), `missing export: ${name}`);
    }
    // SignedIn/UserButton render nothing; SignedOut renders children; the
    // buttons degrade to plain links so the page stays clickable.
    assert.match(shell, /if \(!CLERK_READY\) return null;/);
    assert.match(shell, /if \(!CLERK_READY\) return <>\{children\}<\/>;/);
    assert.match(shell, /if \(!CLERK_READY\) return <Link href="\/sign-in">/);
    assert.match(shell, /if \(!CLERK_READY\) return <Link href="\/sign-up">/);
  });

  test('public pages import the wrappers, never @clerk/nextjs directly', () => {
    const publicPages = [
      'app/landing-client.tsx',
      'app/pricing/page.tsx',
    ];
    for (const rel of publicPages) {
      const code = stripComments(src(rel));
      assert.ok(
        !/from '@clerk\/nextjs'/.test(code),
        `${rel} must not import Clerk components directly (they throw without a provider)`,
      );
      assert.match(code, /from '@\/components\/clerk-shell'/);
    }
  });

  test('sign-in and sign-up degrade to a static panel', () => {
    for (const rel of ['app/sign-in/[[...sign-in]]/page.tsx', 'app/sign-up/[[...sign-up]]/page.tsx']) {
      const code = stripComments(src(rel));
      assert.match(code, /if \(!clerkIsConfigured\(process\.env\)\)/);
      assert.match(code, /<AuthUnavailable mode=/);
    }
  });

  test('AuthUnavailable is pure static UI (no DB, no Clerk, no fetch)', () => {
    const code = stripComments(src('components/auth-unavailable.tsx'));
    assert.ok(!/from '@\/lib\/db'/.test(code), 'must not touch the database');
    assert.ok(!/@clerk/.test(code), 'must not depend on Clerk');
    assert.ok(!/\bfetch\(/.test(code), 'must not perform network calls');
  });
});

describe('RC1 — the landing page never calls auth() directly', () => {
  test('app/page.tsx uses safeAuth, not auth', () => {
    const code = stripComments(src('app/page.tsx'));
    assert.match(code, /from '@\/lib\/auth\/safe-auth'/);
    assert.match(code, /await safeAuth\(\)/);
    assert.ok(!/await auth\(\)/.test(code), 'landing page must not call auth() directly');
    assert.ok(!/from '@clerk\/nextjs\/server'/.test(code));
  });

  test('safeAuth degrades to signed-out instead of throwing', () => {
    const code = stripComments(src('lib/auth/safe-auth.ts'));
    assert.match(code, /if \(!clerkIsConfigured\(process\.env\)\)/);
    assert.match(code, /try\s*\{[\s\S]*?await auth\(\)[\s\S]*?\}\s*catch/);
    assert.match(code, /userId: null, degraded: true/);
  });

  test('safeAuth rethrows Next control-flow errors (dynamic/redirect/notFound)', () => {
    // `auth()` reads headers, so it trips DYNAMIC_SERVER_USAGE during static
    // prerender. A blanket catch swallows that marker and the route can be
    // prerendered with signed-out content baked in.
    const code = stripComments(src('lib/auth/safe-auth.ts'));
    assert.match(code, /isControlFlowError/);
    assert.match(code, /if \(isControlFlowError\(err\)\) throw err;/);
    // And the rethrow must come BEFORE the console.error fallback.
    const rethrowAt = code.indexOf('throw err');
    const logAt = code.indexOf('console.error');
    assert.ok(rethrowAt > -1 && logAt > -1, 'expected both a rethrow and a log');
    assert.ok(rethrowAt < logAt, 'control-flow rethrow must precede the error log');
  });
});

describe('RC4 — /api/health exists and is publicly reachable', () => {
  test('the route handler exists', () => {
    const p = join(MAIN, 'app/api/health/route.ts');
    assert.ok(existsSync(p), 'app/api/health/route.ts must exist');
  });

  test('the route exports GET and never touches the database unguarded', () => {
    const route = src('app/api/health/route.ts');
    const code = stripComments(route);
    assert.match(code, /export async function GET/);
    assert.match(code, /status:\s*200|NextResponse\.json/);
  });

  test('the route reports a degraded-but-alive status when the DB is down', () => {
    const route = stripComments(src('app/api/health/route.ts'));
    assert.match(route, /database/i);
    assert.match(route, /catch/);
  });

  test('middleware lists /api/health as public', () => {
    const core = stripComments(src('lib/auth/route-guard-core.ts'));
    assert.match(core, /\/api\/health/);
  });
});
