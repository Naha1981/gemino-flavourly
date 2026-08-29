/**
 * Pure, framework-free route-guarding decisions for the Clerk middleware.
 *
 * Why this file exists
 * --------------------
 * `clerkMiddleware(...)` throws synchronously the moment its callback calls
 * `auth()` without a usable publishable key:
 *
 *   Error: @clerk/nextjs: Missing publishableKey.
 *
 * Because EVERY request that matches `config.matcher` runs through the
 * middleware, that single throw turned into a 500 on every route in the app
 * — including `/`, `/pricing`, `/privacy` and `/terms`, which need no auth
 * and touch no database. That is the "the app does not load at all"
 * signature: a mis-set env var takes down the marketing site too.
 *
 * This module isolates the two decisions that must never depend on Clerk
 * being configured:
 *   1. `isPublicPath`      — is this route reachable with no session?
 *   2. `isStaticAssetPath` — is this a file that must never be redirected?
 *
 * Both are pure functions of the pathname so they are unit-tested against
 * the real logic (see ./route-guard-core.test.ts) rather than asserted from
 * source text. The Next/Clerk I/O wrapper lives in ../../middleware.ts.
 */

/** Path prefixes/paths that must render for a signed-out visitor. */
const PUBLIC_EXACT = new Set<string>([
  '/',
  '/pricing',
  '/privacy',
  '/terms',
  '/onboarding',
]);

/** Path prefixes that must render for a signed-out visitor. */
const PUBLIC_PREFIXES: string[] = [
  '/sign-in',
  '/sign-up',
  '/claim/',
  '/m/',
  '/s/',
  '/api/auth/status',
  '/api/webhooks',
  '/api/cron',
  '/api/whatsapp',
  '/api/migrate',
  // Health/liveness probes are polled by uptime monitors and by the cron
  // watchdog. They expose no tenant data, so they must never be behind
  // auth() — an auth-gated health endpoint reports a healthy app as down.
  '/api/health',
];

/**
 * Static files that must be served byte-for-byte. Redirecting any of these
 * breaks the PWA install (manifest.json), the favicon, and the self-hosted
 * fonts — and, worse, sends the browser into a redirect loop when the
 * sign-in page itself requests them.
 */
const STATIC_EXTENSIONS = [
  'html',
  'css',
  'js',
  'mjs',
  'json',
  'webmanifest',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'ico',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'txt',
  'xml',
  'csv',
  'pdf',
  'map',
  'lottie',
];

/** Strip the query string and normalise a pathname for matching. */
export function normalizePath(rawPath: string): string {
  const withoutQuery = rawPath.split('?')[0].split('#')[0];
  if (withoutQuery === '') return '/';
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  // Collapse duplicate slashes, then drop a single trailing slash so that
  // "/pricing/" and "/pricing" are the same route.
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) return collapsed.slice(0, -1);
  return collapsed;
}

export function isStaticAssetPath(rawPath: string): boolean {
  const path = normalizePath(rawPath);
  if (path.startsWith('/_next/')) return true;
  if (path.startsWith('/fonts/')) return true;
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = lastSegment.slice(dot + 1).toLowerCase();
  return STATIC_EXTENSIONS.includes(ext);
}

/**
 * True when the route must render for a visitor with no session and no
 * working Clerk configuration.
 */
export function isPublicPath(rawPath: string): boolean {
  const path = normalizePath(rawPath);
  if (isStaticAssetPath(path)) return true;
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Is Clerk usable at all? A `pk_test_`/`pk_live_` key is required before
 * `auth()` can be called; calling it without one throws.
 */
export type EnvLike = Record<string, string | undefined>;

export function clerkIsConfigured(env: EnvLike): boolean {
  // Indexed reads, not named props: `process.env` is typed as an
  // index-signature-only `ProcessEnv`, and a parameter with only optional
  // named properties trips TypeScript's weak-type check against it
  // ("has no properties in common with type ...").
  const key = env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ?? env['CLERK_PUBLISHABLE_KEY'] ?? '';
  return /^pk_(test|live)_[A-Za-z0-9]+$/.test(key.trim());
}

export type GuardAction =
  | { action: 'pass' }
  | { action: 'redirect'; to: string }
  | { action: 'protect' };

/**
 * The single decision the middleware makes per request.
 *
 * Ordering is the fix: public routes and static assets are decided BEFORE
 * anything touches Clerk, so a missing key can never 500 the landing page.
 * When Clerk is unusable we cannot authenticate anyone, so protected routes
 * get a clean redirect to /sign-in rather than a 500.
 */
export function guardRequest(input: {
  rawPath: string;
  clerkConfigured: boolean;
  signInPath?: string;
}): GuardAction {
  const { rawPath, clerkConfigured } = input;
  const signInPath = input.signInPath ?? '/sign-in';

  if (isPublicPath(rawPath)) return { action: 'pass' };
  if (!clerkConfigured) return { action: 'redirect', to: signInPath };
  return { action: 'protect' };
}
