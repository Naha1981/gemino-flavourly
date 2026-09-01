/**
 * GATE UI-3R / F8 — single-active sidebar item.
 *
 * Symptom (S9, S24): `pathname.startsWith(href + '/')` lights up every
 * ancestor of the current route, so /dashboard/customers/vip-today rendered
 * BOTH "Customers" and "VIP Today" as active, and /dashboard/marketing/calendar
 * rendered BOTH "Marketing" and "Calendar".
 *
 * Rule: among the candidate hrefs that match the pathname, exactly ONE —
 * the longest (most specific) — is active. Everything else is inactive.
 * `/dashboard` only matches itself, so the Overview item never lights up on
 * child routes via bare prefix.
 */
export function resolveActiveNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const matches =
      href === '/dashboard'
        ? pathname === '/dashboard'
        : pathname === href || pathname.startsWith(`${href}/`);
    if (!matches) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}
