/**
 * Pure classification of Next.js control-flow "errors".
 *
 * Next signals several non-error conditions by THROWING:
 *
 *   - `DYNAMIC_SERVER_USAGE` — a server component touched `headers`/`cookies`
 *     during static prerender, so the route must be rendered on demand.
 *     `auth()` triggers this, which is why it landed in safeAuth's catch.
 *   - `NEXT_REDIRECT;...`    — `redirect()`
 *   - `NEXT_NOT_FOUND`       — `notFound()`
 *
 * A defensive catch-all that swallows these breaks rendering: the redirect
 * never happens, the 404 never happens, and a route that should be dynamic
 * can be prerendered with stale content. They must be rethrown untouched.
 *
 * Matching is on `digest` only. Message text is not part of Next's contract
 * and changes between versions; a genuine error whose message happens to
 * contain one of these phrases must still be treated as a real failure.
 */

const CONTROL_FLOW_PREFIXES = ['DYNAMIC_SERVER_USAGE', 'NEXT_REDIRECT', 'NEXT_NOT_FOUND'];

export function isControlFlowError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest !== 'string') return false;
  return CONTROL_FLOW_PREFIXES.some((prefix) => digest === prefix || digest.startsWith(`${prefix};`));
}
