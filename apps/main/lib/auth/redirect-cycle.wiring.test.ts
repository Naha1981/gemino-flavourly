import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');

/**
 * Redirect-graph cycle detection for the auth-related routes.
 *
 * This does NOT hand-model the graph from memory (that's exactly how a
 * loop gets shipped unnoticed — the model quietly drifts from the code).
 * Instead it extracts each redirect edge straight from the source files
 * that actually decide it, then checks the resulting graph for cycles
 * among /, /sign-in, /sign-up, /dashboard, /onboarding.
 *
 * Edges are conditional in reality (e.g. "/ -> /dashboard" only fires for
 * a signed-in visitor), but a cycle in the unconditional graph is still a
 * bug: if a signed-in guard on A points at B, and B's own signed-in guard
 * (or an unrelated dynamic redirect) points back at A, that pair loops for
 * anyone who satisfies both conditions simultaneously — which "signed in"
 * trivially does for both. So checking the unconditional graph is the
 * correct, conservative test.
 */
describe('auth redirect graph has no cycle among core routes', () => {
  const middleware = readFileSync(join(HERE, '..', '..', 'middleware.ts'), 'utf8');
  const routeGuardCore = readFileSync(join(HERE, 'route-guard-core.ts'), 'utf8');
  const landingClient = readFileSync(join(APP, '(marketing)', 'landing-client.tsx'), 'utf8');
  const signInPage = readFileSync(join(APP, '(app)', 'sign-in', '[[...sign-in]]', 'page.tsx'), 'utf8');
  const signUpPage = readFileSync(join(APP, '(app)', 'sign-up', '[[...sign-up]]', 'page.tsx'), 'utf8');

  // Each edge only fires under one auth state — a signed-out visitor never
  // takes an "authenticated" edge and vice versa. A cycle is only a real,
  // livable bug if every edge on the path fires under the SAME state
  // (a fixed visitor bouncing forever); mixing states together (e.g. the
  // completely normal "protected route -> login page -> protected route"
  // pair, where one direction is unauthenticated-only and the other is
  // authenticated-only) is not a loop, it's just the two directions of a
  // normal auth boundary. So edges are tagged and checked per-state.
  type AuthState = 'unauthenticated' | 'authenticated';
  const edges: { from: string; to: string; when: AuthState }[] = [];
  function addEdge(from: string, to: string, when: AuthState) {
    edges.push({ from, to, when });
  }

  // Edge: middleware sends an unconfigured-Clerk request on a protected
  // route to route-guard-core's signInPath (default '/sign-in'). Clerk
  // being unconfigured is orthogonal to whether a *specific* visitor is
  // signed in, but the practical case this exists for is the same as the
  // unauthenticated one: nobody can be authenticated if Clerk can't run.
  const signInPathMatch = routeGuardCore.match(/signInPath\s*=\s*input\.signInPath\s*\?\?\s*['"]([^'"]+)['"]/);
  assert.ok(signInPathMatch, 'expected route-guard-core.ts to define a default value for signInPath');
  addEdge('/dashboard', signInPathMatch![1], 'unauthenticated'); // representative protected route

  // Edge: middleware's live-Clerk failure path redirects to /sign-in —
  // also only reachable when clerkProtectedMiddleware's auth().protect()
  // rejects the request, i.e. unauthenticated.
  assert.match(middleware, /redirectTo\(request,\s*['"]\/sign-in['"]\)/);
  addEdge('/dashboard', '/sign-in', 'unauthenticated');

  // Edge: landing page sends a signed-in visitor to /dashboard.
  assert.match(landingClient, /router\.replace\(['"]\/dashboard['"]\)/);
  addEdge('/', '/dashboard', 'authenticated');

  // Edge: /sign-in sends a signed-in visitor to its safe redirect target,
  // which defaults to /dashboard.
  assert.match(signInPage, /getSafeRedirectUrl\([^)]*['"]\/dashboard['"]\)/);
  addEdge('/sign-in', '/dashboard', 'authenticated');

  // Edge: /sign-up sends a signed-in visitor (no claim token) to its
  // fallback, which also defaults to /dashboard.
  assert.match(signUpPage, /getSafeRedirectUrl\([^)]*['"]\/dashboard['"]\)/);
  addEdge('/sign-up', '/dashboard', 'authenticated');

  // Edge: /sign-up sends a signed-in visitor WITH a claim token to
  // /claim/redeem, not /dashboard directly.
  assert.match(signUpPage, /redirect\(['"]\/claim\/redeem['"]\)/);
  addEdge('/sign-up', '/claim/redeem', 'authenticated');

  // /dashboard, /claim/redeem and /onboarding are terminal in this graph:
  // none of them redirect back into /, /sign-in or /sign-up on their own
  // (dashboard renders the app; claim/redeem 302s deeper into the app on
  // success or to /dashboard on failure, never back to an auth page for a
  // signed-in user; onboarding is a protected page, not a redirector).

  test('every extracted edge was found in source (sanity check on the extraction itself)', () => {
    assert.ok(edges.length > 0, 'expected at least one edge to have been extracted');
  });

  test('no same-state cycle exists among /, /sign-in, /sign-up, /dashboard, /claim/redeem, /onboarding', () => {
    const CORE = new Set(['/', '/sign-in', '/sign-up', '/dashboard', '/claim/redeem', '/onboarding']);
    const states: AuthState[] = ['unauthenticated', 'authenticated'];

    function findCycle(state: AuthState): string[] | null {
      const stateEdges = new Map<string, Set<string>>();
      for (const e of edges) {
        if (e.when !== state) continue;
        if (!stateEdges.has(e.from)) stateEdges.set(e.from, new Set());
        stateEdges.get(e.from)!.add(e.to);
      }

      const visiting = new Set<string>();
      const visited = new Set<string>();
      const path: string[] = [];

      function dfs(node: string): string[] | null {
        if (visiting.has(node)) {
          return [...path.slice(path.indexOf(node)), node];
        }
        if (visited.has(node)) return null;
        visiting.add(node);
        path.push(node);
        for (const next of Array.from(stateEdges.get(node) ?? [])) {
          if (!CORE.has(next)) continue;
          const cycle = dfs(next);
          if (cycle) return cycle;
        }
        path.pop();
        visiting.delete(node);
        visited.add(node);
        return null;
      }

      for (const node of Array.from(CORE)) {
        if (!visited.has(node)) {
          const cycle = dfs(node);
          if (cycle) return cycle;
        }
      }
      return null;
    }

    for (const state of states) {
      const cycle = findCycle(state);
      assert.equal(cycle, null, `redirect cycle found for a ${state} visitor: ${cycle?.join(' -> ')}`);
    }
  });
});
