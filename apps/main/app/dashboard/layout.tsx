import { FileText, LayoutDashboard, MessageSquare, QrCode, Settings, Star, Swords, TrendingUp, Users, Radio, BarChart3, CreditCard } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { ReactNode } from 'react';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { brandProfiles } from '@/lib/db/schema';
import { getOrCreateTenant } from '@/lib/tenant';
import { resolveActiveTenant, listManagedTenants } from '@/lib/tenant-resolver';
import { auth } from '@clerk/nextjs/server';
import { ThemeProvider } from '@/components/theme-provider';
import { TenantSwitcher } from '@/components/tenant-switcher';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // S4 — resolve the active tenant through the tenant resolver
  // (?tenant= -> cookie -> owned/membership -> super-admin default). Only
  // when nothing resolves (brand-new user) fall back to getOrCreateTenant.
  const resolved = await resolveActiveTenant();
  let tenant = resolved?.tenant ?? null;
  if (!tenant) tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  // Managed tenants for the sidebar switcher (server-side list; the switch
  // endpoint re-checks grants, so this list alone authorises nothing).
  const { userId } = await auth();
  const managed = userId ? await listManagedTenants(userId) : [];
  const switcherTenants =
    managed.length > 0
      ? managed.map((t) => ({ id: t.id, name: t.name }))
      : [{ id: tenant.id, name: tenant.name }];

  const brand = await db.query.brandProfiles
    .findFirst({ where: eq(brandProfiles.tenantId, tenant.id) })
    .catch(() => null);

  // Pass only the plain serialisable branding fields to the client Provider.
  const themeBrand = brand
    ? {
        brandName: brand.brandName,
        logoUrl: brand.logoUrl,
        logoPath: brand.logoPath,
        primaryColor: brand.primaryColor,
        secondaryColor: brand.secondaryColor,
        backgroundColor: brand.backgroundColor,
        fontFamily: brand.fontFamily,
      }
    : null;

  return (
    <ThemeProvider brand={themeBrand}>
      <DashboardShell switcherTenants={switcherTenants} activeTenantId={tenant.id}>
        {children}
      </DashboardShell>
    </ThemeProvider>
  );
}

function DashboardShell({
  children,
  switcherTenants,
  activeTenantId,
}: {
  children: ReactNode;
  switcherTenants: { id: string; name: string }[];
  activeTenantId: string;
}) {
  const links = [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/dashboard/inbox', label: 'Inbox', icon: MessageSquare },
    { href: '/dashboard/customers', label: 'Customers', icon: Users },
    { href: '/dashboard/customers/vip-today', label: 'VIP Today', icon: Star },
    // Gate #11 — Reputation: Google reviews, response drafting, competitor ratings.
    { href: '/dashboard/reputation', label: 'Reputation', icon: TrendingUp },
    // Gates #15-#18 — Market Intelligence: competitor discovery, menu/price/
    // promotion tracking, market opportunities and positioning.
    {href: '/dashboard/market/competitors', label: 'Market Intelligence', icon: Swords },
    { href: '/dashboard/marketing', label: 'Marketing', icon: FileText },
    { href: '/dashboard/marketing/campaigns', label: 'Campaigns', icon: FileText },
    { href: '/dashboard/marketing/events', label: 'Events', icon: FileText },
    { href: '/dashboard/marketing/calendar', label: 'Calendar', icon: FileText },
    { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
    { href: '/dashboard/operations/channel-configs', label: 'Channels', icon: Radio },
    { href: '/dashboard/operations/approval-requests', label: 'Approvals', icon: TrendingUp },
     { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: QrCode },
     { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
     { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-50">
      <aside className="flex w-64 flex-col border-r border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-4 flex items-center">
          <img src="/logo.png" alt="Flavourly" className="h-9 w-auto" />
        </div>

        {/* S4 — switch between tenants the user manages. */}
        <div className="mb-6">
          <TenantSwitcher tenants={switcherTenants} activeTenantId={activeTenantId} />
        </div>

        <nav className="flex-1 space-y-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 rounded-md px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-50"
            >
              <link.icon className="h-4 w-4 text-emerald-400" />
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto border-t border-zinc-800 pt-4">
          <div className="flex items-center justify-between px-2">
            <span className="text-xs text-zinc-500">Account</span>
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </aside>
      
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  );
}
