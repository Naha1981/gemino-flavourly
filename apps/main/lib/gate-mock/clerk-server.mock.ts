/**
 * GATE V4/V5 — Mock of `@clerk/nextjs/server` for the local gate harness.
 *
 * Active ONLY when GATE_MOCK=1 (the webpack alias in next.config.mjs swaps
 * this module in for the real Clerk package). It impersonates the identity
 * provider and nothing else — see personas.ts for the security model.
 *
 * Exports mirror the surface of `@clerk/nextjs/server` that this app uses:
 *   auth, clerkClient, clerkMiddleware, createRouteMatcher.
 *
 * Identity channel (same as the real session cookie, one hop earlier):
 *   1. `x-gate-user` request header — set by Playwright API fixtures;
 *   2. `__gate_user` cookie — set by the mock sign-in page in the browser.
 * An absent/unknown identity is "signed out": the mock grants nothing and
 * the app's own fail-closed authorization logic decides the rest.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { GATE_PERSONAS, GATE_USER_COOKIE, GATE_USER_HEADER } from './personas';

/**
 * Control-flow marker mirroring Clerk's own architecture: `protect()`
 * throws a tagged error, and the clerkMiddleware wrapper (below) converts
 * it into the correct response — 307 → /sign-in for page requests, 404 for
 * API requests (Clerk's protect() does exactly this split).
 */
const GATE_PROTECT = Symbol.for('gate.protect');
function gateProtectError(): Error {
  const err = new Error('gate: protect control flow');
  (err as unknown as Record<symbol, boolean>)[GATE_PROTECT] = true;
  return err;
}

const PERSONAS_BY_ID = new Map<string, (typeof GATE_PERSONAS)[keyof typeof GATE_PERSONAS]>(
  Object.values(GATE_PERSONAS).map((p) => [p.userId, p]),
);

/** Resolve the mock identity from a NextRequest/Request (headers + cookie). */
function identityFromRequest(req: Request): string | null {
  const headerId = req.headers.get(GATE_USER_HEADER);
  if (headerId && PERSONAS_BY_ID.has(headerId)) return headerId;
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${GATE_USER_COOKIE}=([^;]+)`));
  if (match && PERSONAS_BY_ID.has(decodeURIComponent(match[1]))) {
    return decodeURIComponent(match[1]);
  }
  return null;
}

/** Clerk-user-shaped record the mock would report for a persona. */
function mockClerkUser(userId: string) {
  const persona = PERSONAS_BY_ID.get(userId);
  if (!persona) {
    const err: any = new Error(`Clerk: User could not be found. (${userId})`);
    err.status = 404;
    throw err;
  }
  return {
    id: persona.userId,
    emailAddress: persona.email,
    emailAddresses: [{ id: `email_${persona.userId}`, emailAddress: persona.email, verified: true }],
    firstName: persona.name.split(' ')[0] ?? persona.name,
    lastName: persona.name.split(' ').slice(1).join(' ') || null,
    // Owners carry their tenant in public metadata — exactly what the real
    // tenant.ts stamps after onboarding/claim, so the app's fast path is
    // exercised just like in production.
    publicMetadata: {
      ...(persona.userId === GATE_PERSONAS.tenantAOwner.userId
        ? { tenantId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' }
        : persona.userId === GATE_PERSONAS.tenantBOwner.userId
          ? { tenantId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb' }
          : {}),
    },
    privateMetadata: {},
  };
}

function currentHeaders(): Headers | null {
  try {
    // Next 14: headers() is synchronous; awaiting keeps the mock compatible
    // with both sync and async request scopes.
    return headers();
  } catch {
    return null;
  }
}

/**
 * Mock of Clerk's server `auth()`. Returns the signed-in user id + session
 * claims for a known persona, or an empty object (signed out). It asserts
 * NOTHING about privileges — isSuperAdmin(), the tenant resolver and every
 * route handler's own checks run for real against the seeded DB rows.
 */
export async function auth(): Promise<{
  userId?: string;
  sessionId?: string;
  sessionClaims?: Record<string, unknown>;
}> {
  const h = currentHeaders();
  if (!h) return {};
  const headerId = h.get(GATE_USER_HEADER);
  let userId = headerId && PERSONAS_BY_ID.has(headerId) ? headerId : null;
  if (!userId) {
    const cookieHeader = h.get('cookie') ?? '';
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${GATE_USER_COOKIE}=([^;]+)`));
    if (match) {
      const cid = decodeURIComponent(match[1]);
      if (PERSONAS_BY_ID.has(cid)) userId = cid;
    }
  }
  if (!userId) return {};
  const persona = PERSONAS_BY_ID.get(userId)!;
  return {
    userId,
    sessionId: `gate_mock_session_${userId}`,
    sessionClaims: { email: persona.email, email_verified: true },
  };
}

/**
 * Mock of Clerk's `clerkClient()`. Only the methods the app actually calls:
 * users.getUser (email + public metadata) and users.updateUserMetadata
 * (no-op — the mock's metadata is fixed per persona). Unknown users throw a
 * 404-shaped error, exactly like the real API, so is-super-admin's
 * fail-closed catch path behaves identically.
 */
export function clerkClient(): {
  users: {
    getUser: (userId: string) => Promise<ReturnType<typeof mockClerkUser>>;
    updateUserMetadata: (
      userId: string,
      metadata: { publicMetadata?: Record<string, unknown> },
    ) => Promise<void>;
  };
} {
  return {
    users: {
      getUser: async (userId: string) => mockClerkUser(userId),
      updateUserMetadata: async () => {
        // The mock's persona metadata is immutable by design.
      },
    },
  };
}

/**
 * Mock of `createRouteMatcher` from @clerk/nextjs/server.
 *
 * Supports the string patterns the app's middleware uses: plain paths
 * ('/pricing'), prefix wildcards ('/sign-in(.*)'), and nested wildcards
 * ('/m/(.*)'). Matching is against the URL pathname, like Clerk's.
 */
export function createRouteMatcher(matchers: (string | RegExp)[]) {
  const compile = (pattern: string): RegExp => {
    let re = '';
    for (let i = 0; i < pattern.length; i += 1) {
      if (pattern.startsWith('(.*)', i)) {
        re += '.*';
        i += 3;
        continue;
      }
      if (pattern.startsWith('(.+)', i)) {
        re += '.+';
        i += 3;
        continue;
      }
      const c = pattern[i];
      re += /[A-Za-z0-9_/-]/.test(c) ? c : `\\${c}`;
    }
    return new RegExp(`^${re}/?$`);
  };
  const regexes = matchers.map((m) => (typeof m === 'string' ? compile(m) : m));
  return (request: Request): boolean => {
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return false;
    }
    return regexes.some((r) => r.test(pathname));
  };
}

/**
 * Mock of `clerkMiddleware(handler)`.
 *
 * Mirrors the real middleware's contract: it hands the handler an auth
 * object whose `protect()` throws a redirect to /sign-in when no mock
 * session is present. Public routes (per the app's own matcher list in
 * middleware.ts) are decided by the app — the mock just supplies the
 * identity. Note the mock enforces NOTHING on its own: /dashboard reached
 * while signed out is bounced by the app's `auth().protect()` call, which
 * is exactly what J2 verifies end-to-end.
 */
export function clerkMiddleware(
  handler: (auth: () => { protect: () => void }, req: unknown) => void | Promise<void>,
) {
  return async (req: Request, _event?: unknown) => {
    // This app's middleware.ts calls `auth().protect()` — the middleware
    // callback receives an auth FUNCTION (Clerk v4-style contract), so the
    // mock hands it a zero-arg function that returns the auth object.
    // protect() throws the tagged control-flow error (unauthenticated); the
    // wrapper below converts it — mirroring Clerk's own architecture.
    const auth = () => ({
      protect: () => {
        if (!identityFromRequest(req)) {
          throw gateProtectError();
        }
      },
    });

    try {
      await handler(auth, req);
    } catch (err) {
      const tagged =
        (err as unknown as Record<symbol, unknown>)?.[GATE_PROTECT] === true ||
        (err as { digest?: string })?.digest === 'NEXT_REDIRECT';
      if (!tagged) throw err;

      // Clerk's protect(): page requests → 307 to /sign-in (with the
      // original target preserved); API requests → 404.
      const url = new URL(req.url);
      const accept = req.headers.get('accept') ?? '';
      const secFetchDest = req.headers.get('sec-fetch-dest') ?? '';
      const isPageRequest =
        secFetchDest === 'document' || secFetchDest === 'iframe' || accept.includes('text/html');
      if (isPageRequest) {
        const target = `${url.pathname}${url.search}`;
        const signUrl = new URL(`/sign-in?redirect_url=${encodeURIComponent(target)}`, url);
        return NextResponse.redirect(signUrl, 307);
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 404 });
    }
  };
}
