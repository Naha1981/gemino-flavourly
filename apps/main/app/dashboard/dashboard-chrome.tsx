'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { type ReactNode } from 'react';
import { ThemeToggle, LogoChip } from '@/components/theme-mode';
import { TenantSwitcher } from '@/components/tenant-switcher';

/**
 * Stitch design system shell for /dashboard:
 *   - desktop: white left sidebar (border-r outline-variant) + top header
 *   - mobile: compact header (logo chip + theme toggle) + bottom nav
 *   - Material Symbols Outlined, thin weight, FILL 1 for the active item
 *   - subtle "Demo data" chip while the deadbeef seed dataset is loaded
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

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardChrome({
  children,
  switcherTenants,
  activeTenantId,
  demoActive,
}: {
  children: ReactNode;
  switcherTenants: { id: string; name: string }[];
  activeTenantId: string;
  demoActive: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-app-bg text-app-fg">
      {/* Desktop left sidebar */}
      <aside className="hidden w-64 flex-col border-r border-app-border bg-app-surface-0 p-6 md:flex dark:bg-zinc-900/50">
        <div className="mb-4 flex items-center">
          <LogoChip />
        </div>

        {/* S4 — switch between tenants the user manages. */}
        <div className="mb-6">
          <TenantSwitcher tenants={switcherTenants} activeTenantId={activeTenantId} />
        </div>

        <nav className="flex-1 space-y-1.5">
          {SIDEBAR_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
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
          <div className="flex items-center gap-3 md:hidden">
            <LogoChip className="h-7" />
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
          const active = isActive(pathname, link.href);
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
    </div>
  );
}
