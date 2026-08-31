import { cookies } from 'next/headers';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';

/**
 * GATE 2 — server-side Demo Mode gate.
 *
 * A single cookie holds the toggle, but the cookie alone is NEVER
 * trusted: the expensive isSuperAdmin() check only runs when the cookie
 * is actually set, so:
 *   - standard tenants pay zero extra cost on every request;
 *   - a standard tenant who forges the cookie still gets live data
 *     (fails closed — demo data is display-only anyway, but the
 *     distinction must be visible only to the Super Admin role);
 *   - the Super Admin flips the view for themselves only.
 */
export const DEMO_MODE_COOKIE = 'gemino_demo_mode';

export async function isDemoModeActive(): Promise<boolean> {
  const store = await cookies();
  if (store.get(DEMO_MODE_COOKIE)?.value !== 'on') {
    return false; // fast path — no Clerk/DB work for anyone without the cookie
  }
  return await isSuperAdmin();
}
