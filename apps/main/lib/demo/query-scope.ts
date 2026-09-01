import { sql, type SQL } from 'drizzle-orm';
import { isDeadbeefId } from './deadbeef.ts';

/**
 * GATE UI-3R / F2 — LIVE views read ONLY real rows.
 *
 * Root cause of S2/S13 (R500 "verified revenue" and "25 000" 30-day revenue
 * with zero connected channels): the demo seed writes rows whose ids start
 * with "deadbeef-" (lib/demo/deadbeef.ts) — including six demo "platform
 * tenants" (Marble, Gemelli, SUD, AURUM, Saint, Zioux). Every live query
 * read those rows as if they were real: sample data wearing live clothes.
 *
 * THE RULE GOING FORWARD:
 *   - LIVE views (demo mode OFF) exclude every deadbeef-marked row.
 *   - Demo rows are visible ONLY with Demo Mode ON (the super-admin
 *     view-time toggle) — and then every affected KPI wears a SAMPLE chip
 *     under the amber banner (lib/dashboard/kpi.ts).
 *
 * The guard is display-layer only: it never mutates data, honours the
 * demo-mode DB safety contract (wipe remains the only writer of demo rows),
 * and costs one NOT LIKE predicate per query.
 */

/** True when the id belongs to the demo namespace (deadbeef-…). */
export function isDemoTenantId(tenantId: string | null | undefined): boolean {
  return isDeadbeefId(tenantId);
}

export interface QueryScopeOptions {
  /**
   * true → demo rows are INCLUDED (Demo Mode ON: seed dataset renders with
   * the amber banner + SAMPLE chips). false/undefined → the default LIVE
   * scope, which excludes every deadbeef-marked row.
   */
  includeDemoRows?: boolean;
}

/**
 * SQL predicate that keeps only real rows: `column::text NOT LIKE 'deadbeef-%'`.
 * Returns undefined when demo rows should be included, so callers can spread
 * the result into a drizzle `and(...)` without conditional plumbing.
 */
export function liveRowsOnly(column: unknown, options: QueryScopeOptions = {}): SQL | undefined {
  if (options.includeDemoRows) return undefined;
  return sql`${column}::text NOT LIKE 'deadbeef-%'`;
}
