'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu, Shield, X } from 'lucide-react';
import { ThemeToggle, LogoChip } from '@/components/theme-mode';
import { TenantSwitcher } from '@/components/tenant-switcher';
import { AdminPortalGesture } from '@/components/brand/admin-portal-gesture';
import { resolveActiveNavHref } from '@/lib/nav/active-route';

/**
 * Stitch design system shell for /dashboard:
 *   - desktop: white left sidebar (border-r outline-variant) + top header
 *   - mobile: compact header (logo chip + menu + theme toggle) + bottom nav
 *     PLUS a full hamburger drawer (QA-2) so every feature, button and
 *     account control is reachable from a phone — the 5-item bottom bar
 *     stays as the quick path, the drawer carries the complete nav set.
 *   - Material Symbols Outlined, thin weight, FILL 1 for the active item
 *   - subtle "Demo data" chip while the deadbeef seed dataset is loaded
 *
 * QA-2 / owner spec: the logo is larger (h-12 sidebar / h-9 mobile header)
 * and carries the Super Admin portal gesture — double-click on desktop,
 * press-and-hold 3 seconds on mobile. /admin fails closed on its own, so
 * the gesture is safe to mount for everyone.
 */

export interface NavItem {
  href: string;
  label: string;
  symbol: string;
}

const SIDEBAR_LINKS: NavItem[] = [
  { href: '/dashboard', label: 'Overview', symbol: 'home' },
  { href: '/dashboard/inbox', label: 'Inbox', symbol: 'forum' },
  { href: '/dashboard/customers', label: 'Customers', symbol: 'group' },
  { href: '/dashboard/customers/vip-today', label: 'VIP Today', symbol: 'star' },
  { href: '/dashboard/reputation', label: 'Reputation', symbol: 'trending_up' },
  { href: '/dashboard/market/competitors', label: 'Market Intelligence', symbol: 'storefront' },
  { href: '/dashboard/marketing', label: 'Marketing', symbol: 'campaign' },
  { href: '/dashboard/marketing/campaigns', label: 'Campaigns', symbol: 'campaign' },
  { href: '/dashboard/marketing/events', label: 'Events', symbol: 'event' },
  { href: '/dashboard/marketing/calendar', label: 'Calendar', symbol: 'calendar_month' },
  { href: '/dashboard/analytics', label: 'Analytics', symbol: 'insights' },
  { href: '/dashboard/operations/channel-configs', label: 'Channels', symbol: 'cell_tower' },
  { href: '/dashboard/operations/approval-requests', label: 'Approvals', symbol: 'verified_user' },
  { href: '/dashboard/whatsapp', label: 'WhatsApp', symbol: 'qr_code' },
  { href: '/dashboard/billing', label: 'Billing', symbol: 'credit_card' },
  { href: '/dashboard/settings', label: 'Settings', symbol: 'settings' },
];

/** Mobile bottom nav (spec: Home / Inbox / Customers / Marketing / Market). */
const BOTTOM_LINKS: NavItem[] = [
  { href: '/dashboard', label: 'Home', symbol: 'home' },
  { href: '/dashboard/inbox', label: 'Inbox', symbol: 'forum' },
  { href: '/dashboard/customers', label: 'Customers', symbol: 'group' },
  { href: '/dashboard/marketing', label: 'Marketing', symbol: 'campaign' },
  { href: '/dashboard/market/competitors', label: 'Market', symbol: 'storefront' },
];

/**
 * UI-3R / F8 — exactly ONE nav item may be active per route. The old
 * startsWith matcher lit up every ancestor (S9: Customers + VIP Today both
 * green on /customers/vip-today; S24: Marketing + Calendar on
 * /marketing/calendar). resolveActiveNavHref picks the single most-specific
 * match — used by the desktop sidebar, the mobile bottom nav AND the
 * mobile drawer.
 */

export function DashboardChrome({
  children,
  switcherTenants,
  activeTenantId,
  demoActive,
  adminHint,
}: {
  children: ReactNode;
  switcherTenants: { id: string; name: string }[];
  activeTenantId: string;
  demoActive: boolean;
  /**
   * True when the server has cheaply determined this user may be a super
   * admin (demo cookie active or a super_admin staff row). Only gates the
   * VISIBLE "Super Admin" entry in the mobile drawer — the logo gesture
   * itself is always live and /admin authorizes for real.
   */
  adminHint?: boolean;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const activeSidebarHref = resolveActiveNavHref(
    pathname,
    SIDEBAR_LINKS.map((l) => l.href)
  );
  const activeBottomHref = resolveActiveNavHref(
    pathname,
    BOTTOM_LINKS.map((l) => l.href)
  );

  // Route change closes the drawer (tap a link → navigate → drawer must
  // not linger over the new page).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Drawer open → lock body scroll behind the overlay.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen bg-app-bg text-app-fg">
      {/* Desktop left sidebar */}
      <aside className="hidden w-64 flex-col border-r border-app-border bg-app-surface-0 p-6 md:flex dark:bg-zinc-900/50">
        <div className="mb-4 flex items-center">
          {/* QA-2: bigger logo + Super Admin gesture (dblclick / hold). */}
          <AdminPortalGesture>
            <LogoChip className="h-12" />
          </AdminPortalGesture>
        </div>

        {/* S4 — switch between tenants the user manages. */}
        <div className="mb-6">
          <TenantSwitcher tenants={switcherTenants} activeTenantId={activeTenantId} />
        </div>

        <nav className="flex-1 space-y-1.5">
          {SIDEBAR_LINKS.map((link) => {
            const active = activeSidebarHref === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-app-secondary-container text-app-on-secondary-container dark:bg-zinc-800 dark:text-zinc-50'
                    : 'text-app-muted hover:bg-app-surface-2 hover:text-app-fg dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50'
                }`}
              >
                <span
                  aria-hidden
                  className={`material-symbols-outlined text-[20px] ${active ? 'ms-active' : ''}`}
                >
                  {link.symbol}
                </span>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-app-border pt-4 dark:border-zinc-800">
          <div className="flex items-center justify-between px-2">
            <span className="label-sm text-app-faint dark:text-zinc-500">Account</span>
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-app-border bg-app-surface-0 px-4 py-3 md:px-8 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2 md:hidden">
            {/* QA-2 — mobile: hamburger opens the full-navigation drawer. */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              data-testid="mobile-menu-button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-app-border bg-app-surface-0 text-app-fg transition-colors hover:bg-app-surface-2 active:scale-95"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* QA-2: bigger mobile logo + the same Super Admin gesture. */}
            <AdminPortalGesture>
              <LogoChip className="h-9" />
            </AdminPortalGesture>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            {demoActive && (
              <span
                data-testid="demo-data-chip"
                className="label-sm rounded-full border border-stitch-gold/60 bg-stitch-gold/10 px-3 py-1 text-stitch-brass dark:text-stitch-gold"
              >
                Demo data
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {demoActive && (
              <span
                className="label-sm rounded-full border border-stitch-gold/60 bg-stitch-gold/10 px-3 py-1 text-stitch-brass md:hidden dark:text-stitch-gold"
              >
                Demo
              </span>
            )}
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 pb-24 md:p-8 md:pb-8">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-app-border bg-app-surface-0/95 backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/95">
        {BOTTOM_LINKS.map((link) => {
          const active = activeBottomHref === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 ${
                active ? 'text-app-primary dark:text-stitch-gold' : 'text-app-faint dark:text-zinc-500'
              }`}
            >
              <span aria-hidden className={`material-symbols-outlined text-[22px] ${active ? 'ms-active' : ''}`}>
                {link.symbol}
              </span>
              <span className="label-sm">{link.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* QA-2 — mobile full-navigation drawer: every feature, the tenant
          switcher and the account controls reachable from a phone. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Main menu">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 flex w-[17.5rem] max-w-[85vw] flex-col border-r border-app-border bg-app-surface-0 shadow-2xl">
            <div className="flex items-center justify-between border-b border-app-border px-4 py-3 dark:border-zinc-800">
              <AdminPortalGesture>
                <LogoChip className="h-9" />
              </AdminPortalGesture>
              <button
                type="button"
                ref={closeRef}
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                data-testid="mobile-menu-close"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-app-border text-app-fg transition-colors hover:bg-app-surface-2 active:scale-95"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-4 pt-4">
              <TenantSwitcher tenants={switcherTenants} activeTenantId={activeTenantId} />
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {SIDEBAR_LINKS.map((link) => {
                const active = activeSidebarHref === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-app-secondary-container text-app-on-secondary-container dark:bg-zinc-800 dark:text-zinc-50'
                        : 'text-app-muted hover:bg-app-surface-2 hover:text-app-fg dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`material-symbols-outlined text-[20px] ${active ? 'ms-active' : ''}`}
                    >
                      {link.symbol}
                    </span>
                    {link.label}
                  </Link>
                );
              })}

              {adminHint && (
                <Link
                  href="/admin"
                  className="mt-2 flex items-center gap-3 rounded-xl border border-app-border px-4 py-3 text-sm font-medium text-app-muted transition-colors hover:bg-app-surface-2 hover:text-app-fg dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                  data-testid="drawer-admin-link"
                >
                  <Shield className="h-5 w-5" aria-hidden />
                  Super Admin Portal
                </Link>
              )}
            </nav>

            <div className="border-t border-app-border px-4 py-3 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="label-sm text-app-faint dark:text-zinc-500">Account</span>
                <UserButton afterSignOutUrl="/" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
